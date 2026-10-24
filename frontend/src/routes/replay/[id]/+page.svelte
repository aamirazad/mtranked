<script lang="ts">
  import { onDestroy } from "svelte";
  import { page } from "$app/state";
  import { Pause, Play, RotateCcw } from "@lucide/svelte";
  import type { MatchDetail } from "@mtr/contracts";
  import {
    applyKey,
    calculateWpm,
    caretIndex,
    charStats,
    consistency,
    correctChars,
    createState,
    funboxTypingOptions,
    raceTimeline,
    replay,
    wordHistory,
    type Keystroke,
    type Rules,
    type TypingState,
  } from "@mtr/engine";
  import { api, errorMessage } from "#lib/api.ts";
  import TypingArea from "#lib/components/TypingArea.svelte";
  import ResultStats from "#lib/components/ResultStats.svelte";

  type Track = {
    slot: number;
    name: string;
    color: string;
    caret: string;
    keys: Keystroke[];
    state: TypingState;
    i: number;
  };

  let match = $state<MatchDetail | null>(null);
  let error = $state<string | null>(null);
  let tracks: Track[] = [];
  let focusSlot = $state(0);
  let ts = $state.raw<TypingState>(createState(" "));
  let area: TypingArea | undefined = $state();
  let t = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  let frame = $state(0);
  let duration = $state(1);

  $effect(() => {
    const id = page.params.id ?? "";
    void api.match({ params: { id } }).then((r) => {
      if (r.status !== 200) return void (error = errorMessage(r));
      const m = r.body.match;
      match = m;
      tracks = m.players
        .filter((p) => p.keystrokes?.length)
        .map((p) => ({
          slot: p.slot,
          name: p.name,
          color: p.caretColor === "prism" ? "#e2b714" : p.caretColor,
          caret: p.caretColor,
          keys: p.keystrokes!,
          state: createState(m.text, m.rules as Rules | undefined, funboxTypingOptions(m.funbox)),
          i: 0,
        }));
      duration = Math.max(1000, ...tracks.map((x) => x.keys.at(-1)!.t)) + 300;
      focusSlot = tracks[0]?.slot ?? 0;
      seek(0);
      playing = true;
    });
  });

  /** Advance (or rebuild) each track's state to time `to`. */
  function seek(to: number) {
    const back = to < t;
    t = Math.max(0, Math.min(duration, to));
    for (const tr of tracks) {
      if (back) {
        tr.state = createState(match!.text, match!.rules as Rules | undefined, funboxTypingOptions(match!.funbox));
        tr.i = 0;
      }
      while (tr.i < tr.keys.length && tr.keys[tr.i]!.t <= t) {
        const k = tr.keys[tr.i++]!;
        applyKey(tr.state, k.k, k.t);
      }
    }
    const focused = tracks.find((x) => x.slot === focusSlot);
    if (focused) {
      if (focused.state !== ts) ts = focused.state;
      else area?.sync(true);
    }
    frame++;
  }

  let last = performance.now();
  let raf = requestAnimationFrame(function loop(now) {
    const dt = now - last;
    last = now;
    if (playing && match) {
      seek(t + dt * speed);
      if (t >= duration) playing = false;
    }
    raf = requestAnimationFrame(loop);
  });
  onDestroy(() => cancelAnimationFrame(raf));

  function setFocus(slot: number) {
    focusSlot = slot;
    const tr = tracks.find((x) => x.slot === slot);
    if (tr) ts = tr.state;
  }

  const carets = $derived.by(() => {
    void frame;
    return tracks
      .filter((x) => x.slot !== focusSlot)
      .map((x) => ({ id: String(x.slot), idx: caretIndex(x.state), color: x.caret, name: x.name }));
  });
  const stats = $derived.by(() => {
    void frame;
    return tracks.map((x) => ({
      slot: x.slot,
      name: x.name,
      color: x.color,
      wpm: t < 300 ? 0 : Math.round(calculateWpm(correctChars(x.state, true), x.state.finished ? x.keys.at(-1)!.t : t)),
      done: x.state.finished,
    }));
  });
  // the followed player's full result, scored from their keystrokes
  const summary = $derived.by(() => {
    if (!match) return null;
    const p = match.players.find((x) => x.slot === focusSlot);
    if (!p?.keystrokes?.length) return null;
    const dur = Math.max(1, p.timeMs ?? p.keystrokes.at(-1)!.t);
    const rules = match.rules as Rules | undefined;
    const opts = funboxTypingOptions(match.funbox);
    const timeline = raceTimeline(match.text, p.keystrokes, dur, rules, opts);
    return {
      p,
      timeline,
      consistency: consistency(timeline),
      chars: charStats(replay(match.text, p.keystrokes, dur, rules, opts)),
      words: wordHistory(match.text, p.keystrokes, dur, rules, opts),
    };
  });
  const focusColor = $derived(tracks.find((x) => x.slot === focusSlot)?.caret ?? "#e2b714");
</script>

<svelte:head><title>Replay · MT Ranked</title></svelte:head>

{#if error}
  <div class="pt-16 text-center text-sub">{error}</div>
{:else if !match}
  <div class="pt-16 text-center text-sub">loading replay…</div>
{:else}
  <div class="mx-auto max-w-[1000px] animate-fade">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="label">{match.mode} race · {new Date(match.finishedAt).toLocaleString()}</div>
        <h1 class="font-logo text-3xl">replay</h1>
      </div>
      <div class="text-sm text-sub">click a player to follow their typing</div>
    </div>

    <div class="mb-6 flex flex-col gap-2">
      {#each stats as s (s.slot)}
        {@const p = match.players.find((x) => x.slot === s.slot)!}
        <button
          class="grid grid-cols-[2rem_minmax(0,12rem)_1fr_5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-sub-alt"
          class:bg-sub-alt={s.slot === focusSlot}
          onclick={() => setFocus(s.slot)}
        >
          <span class="text-sub">#{p.placement}</span>
          <span class="truncate" style="color: {s.slot === focusSlot ? s.color : 'inherit'}">{s.name}</span>
          <span class="text-xs text-sub"
            >{Math.round(p.wpm)} wpm final · {Math.round(p.acc)}% acc {p.delta !== null
              ? `· ${p.delta >= 0 ? "+" : ""}${Math.round(p.delta)}`
              : ""}</span
          >
          <span class="text-right tabular-nums">{s.wpm} <span class="text-sub">wpm</span></span>
        </button>
      {/each}
    </div>

    <TypingArea bind:this={area} {ts} {carets} active={false} caretColor={focusColor} />

    <div class="mt-8 flex items-center gap-4">
      <button
        class="btn"
        onclick={() => (t >= duration ? (seek(0), (playing = true)) : (playing = !playing))}
        aria-label={playing ? "pause" : "play"}
      >
        {#if playing}<Pause size={16} />{:else if t >= duration}<RotateCcw size={16} />{:else}<Play size={16} />{/if}
      </button>
      <input
        type="range"
        class="flex-1 accent-[var(--color-main)]"
        min="0"
        max={duration}
        step="10"
        value={t}
        oninput={(e) => seek(Number(e.currentTarget.value))}
        aria-label="seek"
      />
      <span class="w-16 text-right text-sm text-sub tabular-nums">{(t / 1000).toFixed(1)}s</span>
      <select class="bg-transparent text-sm text-sub outline-none" bind:value={speed} aria-label="speed">
        {#each [0.5, 1, 2, 4] as s (s)}<option value={s}>{s}x</option>{/each}
      </select>
    </div>

    {#if summary}
      <div class="mt-12">
        <div class="label mb-4 text-sm">{summary.p.name}'s result</div>
        <ResultStats
          wpm={summary.p.wpm}
          acc={summary.p.acc}
          raw={summary.p.raw}
          timeMs={summary.p.timeMs}
          consistency={summary.consistency}
          chars={summary.chars}
          timeline={summary.timeline}
          words={summary.words}
        />
      </div>
    {/if}
  </div>
{/if}
