<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { Flag, Timer, WifiOff } from "@lucide/svelte";
  import {
    applyKey,
    calculateWpm,
    caretIndex,
    correctChars,
    createState,
    accuracy,
    funboxTypingOptions,
    describeRules,
    type Keystroke,
    type TypingState,
  } from "@mtr/engine";
  import { HURRY_MS, INPUT_BATCH_MS } from "@mtr/race-protocol";
  import { resolveEquipped } from "@mtr/shared";
  import { game, type RaceFeed } from "#lib/game.svelte.ts";
  import { session } from "#lib/session.svelte.ts";
  import TypingArea from "./TypingArea.svelte";
  import TierBadge from "./TierBadge.svelte";
  import LiveStats from "./LiveStats.svelte";

  // `feed`: render a race we're watching instead of our own
  let { onleave, feed, watching }: { onleave?: () => void; feed?: RaceFeed; watching?: string } = $props();
  const src = $derived(feed ?? game);

  const race = $derived(src.race!);
  const meId = $derived(game.you?.id);
  const isRacer = $derived(race.players.some((p) => p.id === meId));
  // funbox only ever applies in private rooms
  const funbox = $derived(race.mode === "private" ? (race.settings.funbox ?? []) : []);
  /** forfeited (left, idle or disconnected too long) */
  const iAmOut = $derived(!!meId && !!src.live[meId]?.out);
  const eq = $derived(resolveEquipped(session.me?.equipped));

  let ts = $state.raw<TypingState>(createState(" "));
  let version = $state(0);
  let area: TypingArea | undefined = $state();
  let startPerf = $state(Infinity);
  let now = $state(performance.now());
  let finishedAt = $state<number | null>(null);
  // `ts` is mutated in place, so templates read this instead of `ts.finished`
  const done = $derived(finishedAt !== null);
  // the finished card covers the text at first, then docks below it so the player can watch the others
  const DOCK_MS = 2500;
  let docked = $state(false);
  $effect(() => {
    if (!done) return void (docked = false);
    const id = setTimeout(() => (docked = true), DOCK_MS);
    return () => clearTimeout(id);
  });
  let pending: Keystroke[] = [];
  let seqBase = 0;
  let seqN = 0;

  // (re)initialize whenever a new race (or a resume) arrives
  $effect(() => {
    const r = race;
    untrack(() => {
      const state = createState(r.text, r.settings.rules, funboxTypingOptions(r.settings.funbox));
      for (const k of r.resumeKeys ?? []) applyKey(state, k.k, k.t);
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
    if (!isRacer || iAmOut || !started || ts.finished || ts.failed || timeUp || src.result) return;
    const t = Math.round(performance.now() - startPerf);
    applyKey(ts, k, t);
    pending.push({ k, t });
    area?.sync();
    version++;
    // a failed room rule: the server replays the same keys and agrees
    if (ts.failed) flush();
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
  const myBurst = $derived.by(() => (void version, ts.lastBurst ?? 0));
  /** failed a room rule (the server decides min speed/accuracy) */
  const myFailed = $derived.by(() => (void version, ts.failed ?? (meId ? src.live[meId]?.failed : undefined) ?? null));
  const ruleList = $derived(describeRules(race.settings.rules));
  const myProgress = $derived.by(() => {
    void version;
    return race.timeLimit ? Math.min(1, elapsed / race.timeLimit) : caretIndex(ts) / Math.max(1, ts.textLength);
  });

  const PRISM = "linear-gradient(90deg, #ff6b9a, #e2b714, #5ce0a0, #5cb8ff, #a78bfa)";

  const lanes = $derived.by(() => {
    void version;
    return race.players.map((p) => {
      const mine = p.id === meId;
      const live = src.live[p.id];
      const idx = mine ? caretIndex(ts) : (live?.idx ?? 0);
      return {
        p,
        mine,
        progress: Math.min(1, idx / Math.max(1, ts.textLength)),
        wpm: mine ? myWpm : (live?.wpm ?? 0),
        done: mine ? done : !!live?.done,
        dc: !!live?.dc,
        out: !!live?.out,
        failed: mine ? (myFailed ?? undefined) : live?.failed,
        color: p.caretColor === "prism" ? PRISM : p.caretColor,
      };
    });
  });

  const carets = $derived(
    race.players
      .filter((p) => p.id !== meId)
      .map((p) => ({
        id: p.id,
        idx: src.live[p.id]?.idx ?? 0,
        color: p.caretColor,
        shape: p.caretShape,
        // labels help tell a few opponents apart; past ~6 they just bury the text
        name: (race.players.length > 2 && race.players.length <= 6) || p.ghost ? (p.ghost ? `ghost · ${p.name}` : p.name) : undefined,
      })),
  );

  const clock = $derived.by(() => {
    if (race.timeLimit) return Math.max(0, Math.ceil((race.timeLimit - elapsed) / 1000));
    const s = Math.floor(elapsed / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
  const waitingFor = $derived(lanes.filter((l) => !l.mine && !l.done && !l.out).map((l) => l.p.name));
  const waitingText = $derived(
    waitingFor.length > 4 ? `${waitingFor.slice(0, 3).join(", ")} and ${waitingFor.length - 3} more` : waitingFor.join(", "),
  );
  // 0: 1v1/ranked look, 1: tighter rows, 2: also two columns on md+ (private rooms up to 16)
  const density = $derived(race.players.length > 8 ? 2 : race.players.length > 4 ? 1 : 0);
  // private-room host can call time once they're done
  const isHost = $derived(!feed && race.mode === "private" && !!meId && !!game.room?.hosts.includes(meId));
  const canHurry = $derived(isHost && !race.timeLimit && !race.deadline && done && waitingFor.length > 0 && !src.result);
  const hurryLeft = $derived((void now, race.deadline ? Math.max(0, Math.ceil((race.deadline - game.serverNow()) / 1000)) : 0));
  const timeUp = $derived(!!race.deadline && hurryLeft === 0);

  let confirmLeave = $state(false);
  function leave() {
    if (!confirmLeave && isRacer && !done) {
      confirmLeave = true;
      setTimeout(() => (confirmLeave = false), 3000);
      return;
    }
    if (!feed) game.leaveRace();
    onleave?.();
  }
</script>

<div class="mx-auto max-w-[1000px] animate-fade">
  <!-- lanes -->
  <div
    class={[
      density === 0 && "mb-8 flex flex-col gap-2.5 text-sm",
      density === 1 && "mb-6 flex flex-col gap-1 text-xs",
      density === 2 && "mb-6 grid gap-x-8 gap-y-1 text-xs md:grid-cols-2",
    ]}
  >
    {#each lanes as l (l.p.id)}
      <div
        class={["grid items-center", density ? "grid-cols-[minmax(0,8rem)_1fr_4rem] gap-3" : "grid-cols-[minmax(0,11rem)_1fr_4.5rem] gap-4"]}
        class:opacity-50={l.out}
      >
        <div class="flex min-w-0 items-center gap-2">
          {#if (race.mode === "ranked" || l.p.ghost) && l.p.rating !== undefined}
            <TierBadge rating={l.p.rating} races={l.p.races} size="sm" showRating={!!l.p.ghost} />
          {/if}
          <span class="truncate" class:text-main={l.mine}>{l.p.ghost ? `ghost · ${l.p.name}` : l.p.name}</span>
          {#if l.dc}<WifiOff size={14} class="shrink-0 text-error" />{/if}
          {#if l.failed}<span class="text-xs text-error">failed</span>{:else if l.out}<span class="text-xs text-error">left</span>{/if}
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

  <LiveStats
    show={started}
    counter={clock}
    progress={myProgress}
    wpm={isRacer ? myWpm : undefined}
    acc={isRacer ? myAcc : undefined}
    burst={isRacer ? myBurst : undefined}
  >
    {#if ruleList.length && !race.deadline}<span class="ml-auto self-center text-xs text-sub" title="room rules">{ruleList.join(" · ")}</span>{/if}
    {#if race.deadline && !src.result}
      <span class="ml-auto flex items-center gap-2 text-xl text-error tabular-nums animate-pop">
        <Timer size={20} />{timeUp ? "time's up" : `finish in ${hurryLeft}s`}
      </span>
    {/if}
    {#if !isRacer}<span class="text-sub">{feed ? `watching ${watching ?? "the race"}` : "spectating — you'll join the next race"}</span>{/if}
    {#if funbox.length}<span class="self-center text-sm text-sub" class:ml-auto={!ruleList.length || !!race.deadline}>funbox · <span class="text-main">{funbox.map((id) => id.replaceAll("_", " ")).join(", ")}</span></span>{/if}
  </LiveStats>

  <!-- tall enough for the finished card even when the text is short -->
  <div class="relative" class:min-h-64={isRacer && done && !src.result && !docked}>
    <TypingArea
      bind:this={area}
      {ts}
      {onkey}
      {carets}
      active={isRacer && !iAmOut && !myFailed && !done && !timeUp}
      allowAllLines={race.settings.mode !== "time"}
      blurred={!started}
      caretColor={eq.caretColor}
      caretShape={eq.caretShape}
      showOwnCaret={isRacer}
      {funbox}
    />
    {#if !started && countdown > 0}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        {#key countdown}
          <div class="animate-pop font-logo text-8xl text-main drop-shadow-lg">{countdown}</div>
        {/key}
      </div>
    {/if}
    {#if isRacer && done && !src.result && !docked}
      <div class="absolute inset-0 flex items-center justify-center bg-bg/80 backdrop-blur-[2px] animate-fade" out:fade={{ duration: 250 }}>
        <div class="flex flex-col items-center gap-3 text-center animate-pop">
          <div class="flex items-center gap-2 font-logo text-4xl text-main"><Flag size={28} /> finished!</div>
          {@render finishedInfo()}
        </div>
      </div>
    {/if}
    {#if started && elapsed < 450 && isRacer && !race.resumeKeys}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div class="animate-pop font-logo text-7xl text-main" style="opacity: {1 - elapsed / 450}">go!</div>
      </div>
    {/if}
  </div>

  {#if isRacer && done && !src.result && docked}
    <div class="mt-6 flex flex-col items-center gap-3 text-center" in:fly={{ y: -80, duration: 400 }}>
      <div class="flex items-center gap-2 font-logo text-2xl text-main"><Flag size={20} /> finished!</div>
      {@render finishedInfo()}
    </div>
  {/if}

  {#snippet finishedInfo()}
    <div class="text-lg text-sub tabular-nums">
      <span class="text-text">{myWpm}</span> wpm · <span class="text-text">{myAcc}%</span> acc ·
      <span class="text-text">{((finishedAt ?? 0) / 1000).toFixed(1)}s</span>
    </div>
    {#if waitingFor.length}
      <div class="text-sm text-sub">
        {race.deadline ? "race ends when the timer runs out" : `waiting for ${waitingText} to finish…`}
      </div>
    {/if}
    {#if canHurry}
      <button class="btn btn-main mt-1" onclick={() => game.send({ type: "room.hurry" })}>
        <Timer size={16} /> call time · {HURRY_MS / 1000}s
      </button>
      <div class="text-xs text-sub">everyone still typing gets {HURRY_MS / 1000} seconds to finish</div>
    {/if}
  {/snippet}

  <div class="mt-8 flex min-h-10 items-center justify-between text-sm text-sub">
    <div>
      {#if myFailed && !src.result}
        <span class="text-error">you failed this race · {myFailed}</span> · waiting for it to end…
      {:else if iAmOut && !src.result}
        <span class="text-error">you forfeited this race</span> (left or idle for too long) · waiting for it to end…
      {/if}
      {#if race.source}<span class="ml-2">— {race.source}</span>{/if}
    </div>
    {#if !src.result && !iAmOut}
      <button class="btn btn-ghost text-sm" onclick={leave}>{feed ? "stop watching" : confirmLeave ? "click again to forfeit" : "leave"}</button>
    {/if}
  </div>
</div>
