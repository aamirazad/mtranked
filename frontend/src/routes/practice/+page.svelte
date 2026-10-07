<script lang="ts">
  import { onDestroy } from "svelte";
  import { RotateCcw } from "@lucide/svelte";
  import {
    applyKey,
    calculateWpm,
    correctChars,
    createState,
    finalStats,
    generateText,
    randomSeed,
    LANGUAGES,
    type FinalStats,
    type TextSettings,
    type TypingState,
  } from "@mtr/engine";
  import TypingArea from "#lib/components/TypingArea.svelte";
  import { session } from "#lib/session.svelte.ts";
  import { resolveEquipped } from "@mtr/shared";

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
  let result = $state<(FinalStats & { time: number }) | null>(null);
  let source = $state<string | undefined>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;

  const eq = $derived(resolveEquipped(session.me?.equipped));

  async function restart() {
    clearInterval(timer);
    const gen = ++generation;
    localStorage.setItem("practice", JSON.stringify(settings));
    const t = await generateText($state.snapshot(settings), randomSeed());
    if (gen !== generation) return;
    source = t.source;
    result = null;
    startedAt = null;
    ts = createState(t.text);
  }
  void restart();
  onDestroy(() => clearInterval(timer));

  function onkey(k: string) {
    if (result) return;
    if (startedAt === null) {
      startedAt = performance.now();
      timer = setInterval(() => {
        now = performance.now();
        if (settings.mode === "time" && now - startedAt! >= settings.time * 1000) finish();
      }, 100);
    }
    applyKey(ts, k);
    area?.sync();
    version++;
    now = performance.now();
    if (ts.finished) finish();
  }

  function finish() {
    clearInterval(timer);
    const ms = settings.mode === "time" ? settings.time * 1000 : performance.now() - startedAt!;
    result = { ...finalStats(ts, ms), time: ms / 1000 };
  }

  const elapsed = $derived(startedAt === null ? 0 : now - startedAt);
  // ts is raw engine state; `version` ticks after every key
  const liveWpm = $derived.by(() => {
    void version;
    return startedAt === null || elapsed < 500 ? 0 : Math.round(calculateWpm(correctChars(ts, true), elapsed));
  });
  const counter = $derived.by(() => {
    void version;
    return settings.mode === "time"
      ? Math.max(0, Math.ceil(settings.time - elapsed / 1000))
      : `${Math.min(ts.wi, ts.words.length)}/${ts.words.length}`;
  });

  function set<K extends keyof TextSettings>(k: K, v: TextSettings[K]) {
    settings[k] = v;
    void restart();
  }

  function onwindowkey(e: KeyboardEvent) {
    if (e.key === "Tab") {
      e.preventDefault();
      void restart();
    }
  }
</script>

<svelte:window onkeydown={onwindowkey} />
<svelte:head><title>practice · mt ranked</title></svelte:head>

<div class="mx-auto max-w-[1000px]">
  <div class="mb-10 flex flex-wrap items-center justify-center gap-1 rounded-lg bg-sub-alt px-3 py-1.5 text-sm transition-opacity" class:opacity-0={startedAt !== null && !result}>
    <button class="toggle" class:on={settings.punctuation} onclick={() => set("punctuation", !settings.punctuation)}>@ punctuation</button>
    <button class="toggle" class:on={settings.numbers} onclick={() => set("numbers", !settings.numbers)}># numbers</button>
    <span class="mx-2 h-4 w-1 rounded bg-bg"></span>
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
    <select class="cursor-pointer bg-transparent text-sub outline-none hover:text-text" value={settings.language} onchange={(e) => set("language", e.currentTarget.value as TextSettings["language"])}>
      {#each LANGUAGES as l (l)}<option value={l}>{l.replace("_", " ")}</option>{/each}
    </select>
  </div>

  {#if !result}
    <div class="animate-fade">
      <div class="mb-2 flex h-9 items-end gap-6 text-3xl text-main">
        {#if startedAt !== null}
          <span>{counter}</span>
          <span class="text-xl text-sub">{liveWpm} wpm</span>
        {/if}
      </div>
      <TypingArea bind:this={area} {ts} {onkey} caretColor={eq.caretColor} caretShape={eq.caretShape} />
      <div class="mt-8 flex justify-center">
        <button class="btn btn-ghost" onclick={restart} title="restart (tab)"><RotateCcw size={18} /></button>
      </div>
    </div>
  {:else}
    <div class="animate-rise">
      <div class="flex flex-wrap items-end gap-12">
        <div>
          <div class="label text-2xl">wpm</div>
          <div class="text-7xl text-main">{Math.round(result.wpm)}</div>
        </div>
        <div>
          <div class="label text-2xl">acc</div>
          <div class="text-7xl text-main">{Math.round(result.acc)}%</div>
        </div>
        <div class="grid grid-cols-3 gap-8 pb-2">
          <div><div class="label">raw</div><div class="text-2xl text-main">{Math.round(result.raw)}</div></div>
          <div><div class="label">time</div><div class="text-2xl text-main">{result.time.toFixed(1)}s</div></div>
          <div><div class="label">test</div><div class="text-2xl text-main">{settings.mode} {settings.mode === "time" ? settings.time : settings.mode === "words" ? settings.words : settings.quoteLength}</div></div>
        </div>
      </div>
      {#if source}<div class="mt-6 text-sm text-sub">— {source}</div>{/if}
      <div class="mt-10 flex items-center gap-4">
        <button class="btn" onclick={restart}><RotateCcw size={16} /> next test</button>
        <span class="text-sm text-sub"><kbd>tab</kbd> to restart</span>
        <a href="/" class="ml-auto link text-sm">ready to race someone? →</a>
      </div>
    </div>
  {/if}
</div>
