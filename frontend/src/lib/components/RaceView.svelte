<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { Flag, WifiOff } from "@lucide/svelte";
  import {
    applyKey,
    calculateWpm,
    caretIndex,
    correctChars,
    createState,
    accuracy,
    type Keystroke,
    type TypingState,
  } from "@mtr/engine";
  import { INPUT_BATCH_MS } from "@mtr/race-protocol";
  import { resolveEquipped } from "@mtr/shared";
  import { game } from "#lib/game.svelte.ts";
  import { session } from "#lib/session.svelte.ts";
  import TypingArea from "./TypingArea.svelte";
  import TierBadge from "./TierBadge.svelte";

  let { onleave }: { onleave?: () => void } = $props();

  const race = $derived(game.race!);
  const meId = $derived(game.you?.id);
  const isRacer = $derived(race.players.some((p) => p.id === meId));
  const eq = $derived(resolveEquipped(session.me?.equipped));

  let ts = $state.raw<TypingState>(createState(" "));
  let version = $state(0);
  let area: TypingArea | undefined = $state();
  let startPerf = $state(Infinity);
  let now = $state(performance.now());
  let finishedAt = $state<number | null>(null);
  let pending: Keystroke[] = [];
  let seqBase = 0;
  let seqN = 0;

  // (re)initialise whenever a new race (or a resume) arrives
  $effect(() => {
    const r = race;
    untrack(() => {
      const state = createState(r.text);
      for (const k of r.resumeKeys ?? []) applyKey(state, k.k);
      ts = state;
      pending = [];
      // sequence numbers only need to increase, also across reconnects
      seqBase = Date.now();
      seqN = 0;
      finishedAt = state.finished ? (r.resumeKeys?.at(-1)?.t ?? 0) : null;
      startPerf = performance.now() + (r.startAt - game.serverNow());
      version++;
    });
  });

  let raf = 0;
  const loop = () => {
    now = performance.now();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const batch = setInterval(flush, INPUT_BATCH_MS);
  onDestroy(() => {
    cancelAnimationFrame(raf);
    clearInterval(batch);
    flush();
  });

  function flush() {
    if (!pending.length || !game.race) return;
    game.send({ type: "input.batch", raceId: game.race.raceId, seq: seqBase + ++seqN, keys: pending.splice(0, 200) });
  }

  const started = $derived(now >= startPerf);
  const countdown = $derived(Math.ceil((startPerf - now) / 1000));
  const elapsed = $derived(Math.max(0, now - startPerf));

  function onkey(k: string) {
    if (!isRacer || !started || ts.finished || game.result) return;
    const t = Math.round(performance.now() - startPerf);
    applyKey(ts, k);
    pending.push({ k, t });
    area?.sync();
    version++;
    if (ts.finished) {
      finishedAt = t;
      flush(); // send the final key straight away: finish time is server-measured
    }
  }

  const myWpm = $derived.by(() => {
    void version;
    const t = finishedAt ?? elapsed;
    return t < 300 ? 0 : Math.round(calculateWpm(correctChars(ts, true), t));
  });
  const myAcc = $derived.by(() => (void version, Math.round(accuracy(ts))));

  const lanes = $derived.by(() => {
    void version;
    return race.players.map((p) => {
      const mine = p.id === meId;
      const live = game.live[p.id];
      const idx = mine ? caretIndex(ts) : (live?.idx ?? 0);
      return {
        p,
        mine,
        progress: Math.min(1, idx / Math.max(1, ts.textLength)),
        wpm: mine ? myWpm : (live?.wpm ?? 0),
        done: mine ? ts.finished : !!live?.done,
        dc: !!live?.dc,
        out: !!live?.out,
        color: p.caretColor === "prism" ? "#e2b714" : p.caretColor,
      };
    });
  });

  const carets = $derived(
    race.players
      .filter((p) => p.id !== meId)
      .map((p) => ({
        id: p.id,
        idx: game.live[p.id]?.idx ?? 0,
        color: p.caretColor === "prism" ? "#e2b714" : p.caretColor,
        name: race.players.length > 2 || p.ghost ? (p.ghost ? `ghost · ${p.name}` : p.name) : undefined,
      })),
  );

  const clock = $derived.by(() => {
    if (race.timeLimit) return Math.max(0, Math.ceil((race.timeLimit - elapsed) / 1000));
    const s = Math.floor(elapsed / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
  const waitingFor = $derived(lanes.filter((l) => !l.mine && !l.done && !l.out).map((l) => l.p.name));

  let confirmLeave = $state(false);
  function leave() {
    if (!confirmLeave && isRacer && !ts.finished) {
      confirmLeave = true;
      setTimeout(() => (confirmLeave = false), 3000);
      return;
    }
    game.leaveRace();
    onleave?.();
  }
</script>

<div class="mx-auto max-w-[1000px] animate-fade">
  <!-- lanes -->
  <div class="mb-8 flex flex-col gap-2.5">
    {#each lanes as l (l.p.id)}
      <div class="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem] items-center gap-4 text-sm" class:opacity-50={l.out}>
        <div class="flex min-w-0 items-center gap-2">
          {#if race.mode === "ranked" && l.p.rating !== undefined}
            <TierBadge rating={l.p.rating} races={l.p.races} size="sm" showRating={false} />
          {/if}
          <span class="truncate" class:text-main={l.mine}>{l.p.ghost ? `ghost · ${l.p.name}` : l.p.name}</span>
          {#if l.dc}<WifiOff size={14} class="shrink-0 text-error" />{/if}
          {#if l.out}<span class="text-xs text-error">left</span>{/if}
        </div>
        <div class="relative h-2 rounded-full bg-sub-alt">
          <div
            class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-100 ease-linear"
            style="width: {l.progress * 100}%; background: {l.color}; opacity: {l.mine ? 1 : 0.7}"
          ></div>
          {#if l.done}<Flag size={14} class="absolute -top-1 right-0 text-main" />{/if}
        </div>
        <div class="text-right tabular-nums text-sub"><span class="text-text">{l.wpm}</span> wpm</div>
      </div>
    {/each}
  </div>

  <div class="mb-2 flex h-10 items-end gap-6">
    {#if started}
      <span class="text-3xl text-main tabular-nums">{clock}</span>
      {#if isRacer}<span class="text-xl text-sub tabular-nums">{myWpm} wpm · {myAcc}%</span>{/if}
    {/if}
    {#if !isRacer}<span class="text-sub">spectating — you'll join the next race</span>{/if}
  </div>

  <div class="relative">
    <TypingArea
      bind:this={area}
      {ts}
      {onkey}
      {carets}
      active={isRacer && !ts.finished}
      blurred={!started}
      caretColor={eq.caretColor}
      caretShape={eq.caretShape}
      showOwnCaret={isRacer}
    />
    {#if !started && countdown > 0}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        {#key countdown}
          <div class="animate-pop font-logo text-8xl text-main drop-shadow-lg">{countdown}</div>
        {/key}
      </div>
    {/if}
    {#if started && elapsed < 450 && isRacer && !race.resumeKeys}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div class="animate-pop font-logo text-7xl text-main" style="opacity: {1 - elapsed / 450}">go!</div>
      </div>
    {/if}
  </div>

  <div class="mt-8 flex min-h-10 items-center justify-between text-sm text-sub">
    <div>
      {#if ts.finished && !game.result}
        <span class="text-main">finished!</span>
        {#if waitingFor.length}waiting for {waitingFor.join(", ")}…{/if}
      {/if}
      {#if race.source}<span class="ml-2">— {race.source}</span>{/if}
    </div>
    {#if !game.result}
      <button class="btn btn-ghost text-sm" onclick={leave}>{confirmLeave ? "click again to forfeit" : "leave"}</button>
    {/if}
  </div>
</div>
