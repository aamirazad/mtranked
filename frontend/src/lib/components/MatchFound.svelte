<script lang="ts">
  import { onDestroy } from "svelte";
  import type { MatchFound } from "#lib/game.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import TierBadge from "./TierBadge.svelte";

  let { match }: { match: MatchFound } = $props();
  let now = $state(Date.now());
  const iv = setInterval(() => (now = Date.now()), 100);
  onDestroy(() => clearInterval(iv));

  const meId = $derived(game.you?.id);
  const me = $derived(match.players.find((p) => p.id === meId));
  const opp = $derived(match.players.find((p) => p.id !== meId));
  const imReady = $derived(!!meId && match.ready.includes(meId));
  // re-evaluated every 100ms via `now`
  const left = $derived((void now, Math.max(0, match.readyBy - game.serverNow())));
  const total = 10_000;

  function ready() {
    if (!imReady) game.send({ type: "ready", matchId: match.matchId });
  }
  function decline() {
    game.send({ type: "decline", matchId: match.matchId });
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ready();
    }
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="fixed inset-0 z-40 flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade">
  <div class="w-[min(640px,92vw)] animate-pop rounded-2xl bg-sub-alt p-8 shadow-2xl">
    <div class="mb-6 text-center text-sm tracking-[0.3em] text-main uppercase">{match.mode} match found</div>
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
      {#each [me, null, opp] as p, i (i)}
        {#if i === 1}
          <div class="font-logo text-3xl text-sub">vs</div>
        {:else if p}
          <div class="flex flex-col items-center gap-2 text-center" class:opacity-60={!match.ready.includes(p.id)}>
            <div class="text-xl" class:text-main={p.id === meId}>{p.name}</div>
            {#if p.rating !== undefined && match.mode === "ranked"}
              <TierBadge rating={p.rating} races={p.races} />
            {:else}
              <div class="text-sm text-sub">level {p.level}</div>
            {/if}
            <div class="text-xs {match.ready.includes(p.id) ? 'text-win' : 'text-sub'}">{match.ready.includes(p.id) ? "ready" : "waiting"}</div>
          </div>
        {/if}
      {/each}
    </div>
    <div class="mt-8 h-1 overflow-hidden rounded bg-bg">
      <div class="h-full bg-main transition-[width] duration-100 ease-linear" style="width: {(left / total) * 100}%"></div>
    </div>
    <div class="mt-6 flex items-center justify-center gap-3">
      {#if imReady}
        <div class="text-sub">waiting for {opp?.name ?? "opponent"}…</div>
      {:else}
        <button class="btn btn-main px-10 py-3 text-lg" onclick={ready}>ready <kbd class="bg-bg/30 text-bg">enter</kbd></button>
        <button class="btn btn-ghost" onclick={decline}>decline</button>
      {/if}
    </div>
  </div>
</div>
