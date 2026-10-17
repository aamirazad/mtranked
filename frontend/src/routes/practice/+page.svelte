<script lang="ts">
  import { onDestroy } from "svelte";
  import { RotateCcw } from "@lucide/svelte";
  import {
    applyKey,
    accuracy,
    calculateWpm,
    charStats,
    consistency,
    raceTimeline,
    wordHistory,
    checkLiveFail,
    correctChars,
    describeRules,
    createState,
    finalStats,
    funboxTypingOptions,
    generateText,
    randomSeed,
    type FailReason,
    type FinalStats,
    type Keystroke,
    type Rules,
    type TextSettings,
    type TypingState,
  } from "@mtr/engine";
  import TypingArea from "#lib/components/TypingArea.svelte";
  import FunboxPicker from "#lib/components/FunboxPicker.svelte";
  import TextOptionsPicker from "#lib/components/TextOptionsPicker.svelte";
  import RulesPicker from "#lib/components/RulesPicker.svelte";
  import LiveStats from "#lib/components/LiveStats.svelte";
  import { session } from "#lib/session.svelte.ts";
  import { resolveEquipped } from "@mtr/shared";
  import { prefs, type QuickRestart } from "#lib/prefs.svelte.ts";
  import { commandLine } from "#lib/components/CommandLine.svelte";
  import ResultStats from "#lib/components/ResultStats.svelte";
  import { api } from "#lib/api.ts";
  import { testType } from "#lib/format.ts";

  const saved = typeof localStorage !== "undefined" ? localStorage.getItem("practice") : null;
  let settings = $state<TextSettings>(
    saved
      ? JSON.parse(saved)
      : { mode: "time", time: 30, words: 25, quoteLength: "short", punctuation: false, numbers: false, language: "english" },
  );

  let ts = $state.raw<TypingState>(createState("loading"));
  let version = $state(0);
  let area: TypingArea | undefined = $state();
  let startedAt = $state<number | null>(null);
  let now = $state(Date.now());
  let result = $state<(FinalStats & { time: number; failed: FailReason | null }) | null>(null);
  /** last whole second the min speed/accuracy rules were checked */
  let ruleSec = 0;
  // result-screen extras, computed locally; the server re-scores signed-in tests to save them
  let details = $state.raw<{
    timeline: ReturnType<typeof raceTimeline>;
    words: ReturnType<typeof wordHistory>;
    chars: ReturnType<typeof charStats>;
    consistency: number;
  } | null>(null);
  let previousBest = $state<number | null>(null);
  let resultSettings = $state<TextSettings | null>(null);
  let seed = "";
  let keys: Keystroke[] = [];
  let source = $state<string | undefined>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;

  const eq = $derived(resolveEquipped(session.me?.equipped));

  async function restart() {
    clearInterval(timer);
    const gen = ++generation;
    localStorage.setItem("practice", JSON.stringify(settings));
    const s = randomSeed();
    const t = await generateText($state.snapshot(settings), s);
    if (gen !== generation) return;
    source = t.source;
    seed = s;
    keys = [];
    details = null;
    previousBest = null;
    result = null;
    startedAt = null;
    ruleSec = 0;
    ts = createState(t.text, settings.rules, funboxTypingOptions(settings.funbox));
  }
  void restart();
  onDestroy(() => clearInterval(timer));

  function onkey(k: string) {
    if (result) return;
    if (startedAt === null) {
      startedAt = performance.now();
      timer = setInterval(() => {
        now = performance.now();
        const sec = Math.floor((now - startedAt!) / 1000);
        if (sec > ruleSec) {
          ruleSec = sec;
          if (checkLiveFail(ts, sec * 1000)) return finish();
        }
        if (settings.mode === "time" && now - startedAt! >= settings.time * 1000) finish();
      }, 100);
    }
    const t = Math.round(performance.now() - startedAt!);
    keys.push({ k, t });
    applyKey(ts, k, t);
    area?.sync();
    version++;
    now = performance.now();
    if (ts.finished || ts.failed) finish();
  }

  function finish() {
    clearInterval(timer);
    const ms = settings.mode === "time" && !ts.failed ? settings.time * 1000 : performance.now() - startedAt!;
    result = { ...finalStats(ts, ms), time: ms / 1000, failed: ts.failed };
    const used = keys.filter((x) => x.t <= ms);
    const text = ts.words.join(" ");
    const opts = funboxTypingOptions(settings.funbox);
    const timeline = raceTimeline(text, used, ms, settings.rules, opts);
    details = {
      timeline,
      words: wordHistory(text, used, ms, settings.rules, opts),
      chars: charStats(ts),
      consistency: consistency(timeline),
    };
    const snap = $state.snapshot(settings);
    resultSettings = snap;
    // failed tests aren't saved (the server only accepts tests that were played out)
    if (session.me && snap.mode !== "custom" && !ts.failed) void save(snap, seed, used);
  }

  async function save(s: TextSettings, sd: string, ks: Keystroke[]) {
    const gen = generation;
    const r = await api.practice.submit({ body: { settings: { ...s, mode: s.mode as "words" | "time" | "quote" }, seed: sd, keys: ks } }).catch(() => null);
    if (gen === generation && r?.status === 200) previousBest = r.body.result.previousBest;
  }

  const elapsed = $derived(startedAt === null ? 0 : now - startedAt);
  // ts is raw engine state; `version` ticks after every key
  const liveWpm = $derived.by(() => {
    void version;
    return startedAt === null || elapsed < 500 ? 0 : Math.round(calculateWpm(correctChars(ts, true), elapsed));
  });
  const liveAcc = $derived.by(() => (void version, Math.round(accuracy(ts))));
  const liveBurst = $derived.by(() => (void version, ts.lastBurst ?? 0));
  const progress = $derived.by(() => {
    void version;
    return settings.mode === "time" ? Math.min(1, elapsed / (settings.time * 1000)) : Math.min(1, ts.wi / ts.words.length);
  });
  const counter = $derived.by(() => {
    void version;
    return settings.mode === "time"
      ? Math.max(0, Math.ceil(settings.time - elapsed / 1000))
      : `${Math.min(ts.wi, ts.words.length)}/${ts.words.length}`;
  });

  const ruleList = $derived(describeRules(settings.rules));

  function set<K extends keyof TextSettings>(k: K, v: TextSettings[K]) {
    settings[k] = v;
    void restart();
  }

  const RESTART_KEYS: Record<QuickRestart, string | null> = { off: null, esc: "Escape", tab: "Tab", enter: "Enter" };
  // the "no quit" funbox: no restarting a test once it's under way
  const noQuit = $derived(!!settings.funbox?.includes("no_quit") && startedAt !== null && !result);

  function onwindowkey(e: KeyboardEvent) {
    if (commandLine.open || noQuit || e.key !== RESTART_KEYS[prefs.quickRestart]) return;
    // let enter still press a focused button
    if (e.key === "Enter" && (e.target as HTMLElement | null)?.closest("button, a, select")) return;
    e.preventDefault();
    void restart();
  }
</script>

<svelte:window onkeydown={onwindowkey} />
<svelte:head><title>Practice · MT Ranked</title></svelte:head>

<div class="mx-auto max-w-[1000px]">
  <div class="mb-3 flex flex-wrap items-center justify-center gap-1 rounded-lg bg-sub-alt px-3 py-1.5 text-sm transition-opacity" class:opacity-0={startedAt !== null && !result}>
    {#each ["time", "words", "quote"] as const as m (m)}
      <button class="toggle" class:on={settings.mode === m} onclick={() => set("mode", m)}>{m}</button>
    {/each}
    <span class="mx-2 h-4 w-1 rounded bg-bg"></span>
    {#if settings.mode === "time"}
      {#each [15, 30, 60, 120] as t (t)}
        <button class="toggle" class:on={settings.time === t} onclick={() => set("time", t)}>{t}</button>
      {/each}
    {:else if settings.mode === "words"}
      {#each [10, 25, 50, 100] as w (w)}
        <button class="toggle" class:on={settings.words === w} onclick={() => set("words", w)}>{w}</button>
      {/each}
    {:else}
      {#each ["short", "medium", "long"] as const as q (q)}
        <button class="toggle" class:on={settings.quoteLength === q} onclick={() => set("quoteLength", q)}>{q}</button>
      {/each}
    {/if}
    <span class="mx-2 h-4 w-1 rounded bg-bg"></span>
    <TextOptionsPicker punctuation={settings.punctuation} numbers={settings.numbers} language={settings.language} onchange={set} />
    <span class="mx-2 h-4 w-1 rounded bg-bg"></span>
    <FunboxPicker value={settings.funbox} onchange={(v) => set("funbox", v.length ? v : undefined)} />
  </div>
  <div class="mx-auto mb-8 max-w-2xl text-center transition-opacity" class:opacity-0={startedAt !== null && !result}>
    <RulesPicker rules={settings.rules} onchange={(r: Rules | undefined) => set("rules", r)} note="your own practice rules. ranked and casual always race without them." />
  </div>

  {#if !result}
    <div class="animate-fade">
      <LiveStats show={startedAt !== null} {counter} {progress} wpm={liveWpm} acc={liveAcc} burst={liveBurst}>
        {#if ruleList.length}<span class="ml-auto self-center text-xs text-sub">{ruleList.join(" · ")}</span>{/if}
      </LiveStats>
      <TypingArea
        bind:this={area}
        {ts}
        {onkey}
        caretColor={eq.caretColor}
        caretShape={eq.caretShape}
        allowAllLines={settings.mode !== "time"}
        funbox={settings.funbox}
      />
      <div class="mt-8 flex justify-center">
        <button class="btn btn-ghost" onclick={restart} disabled={noQuit} title={prefs.quickRestart === "off" ? "restart" : `restart (${prefs.quickRestart})`}><RotateCcw size={18} /></button>
      </div>
    </div>
  {:else}
    <div class="animate-rise">
      {#if result.failed}
        <div class="mb-4 text-2xl text-error">test failed · {result.failed}</div>
      {:else if previousBest !== null && result.wpm > previousBest}
        <div class="mb-4 inline-block rounded-lg bg-main px-3 py-1 text-sm text-bg animate-pop">new personal best!</div>
      {/if}
      <ResultStats
        wpm={result.wpm}
        acc={result.acc}
        raw={result.raw}
        timeMs={result.time * 1000}
        consistency={details?.consistency}
        chars={details?.chars}
        timeline={details?.timeline}
        words={details?.words}
        pb={previousBest}
        testType={testType(resultSettings)}
      />
      {#if source}<div class="mt-6 text-sm text-sub">— {source}</div>{/if}
      <div class="mt-10 flex items-center gap-4">
        <button class="btn" onclick={restart}><RotateCcw size={16} /> next test</button>
        {#if prefs.quickRestart !== "off"}<span class="text-sm text-sub"><kbd>{prefs.quickRestart}</kbd> to restart</span>{/if}
        <a href="/" class="ml-auto link text-sm">ready to race someone? →</a>
      </div>
    </div>
  {/if}
</div>
