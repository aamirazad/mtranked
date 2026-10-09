<script lang="ts">
  import { onDestroy } from "svelte";
  import type { MatchFound } from "#lib/game.svelte.ts";
  import { game } from "#lib/game.svelte.ts";
  import { READY_CHECK_MS } from "@mtr/race-protocol";
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
  const total = READY_CHECK_MS;

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
    <div class="mb-8 flex flex-col items-center gap-1 text-center">
      <div class="text-xs text-sub">{match.mode}</div>
      <div class="font-logo text-3xl text-main">match found</div>
    </div>
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
      {#each [me, null, opp] as p, i (i)}
        {#if i === 1}
          <div class="font-logo text-3xl text-sub">vs</div>
        {:else if p}
          <div
            class="banner flex flex-col items-center gap-2 rounded-xl bg-bg px-4 py-5 text-center outline-2 -outline-offset-2 transition-[outline-color]"
            class:outline-win={match.ready.includes(p.id)}
            class:outline-transparent={!match.ready.includes(p.id)}
            style={p.banner ? `background: ${p.banner}` : undefined}
          >
            <div class="text-xl" class:text-main={p.id === meId}>{p.name}</div>
            {#if p.rating !== undefined && match.mode === "ranked"}
              <TierBadge rating={p.rating} races={p.races} />
            {:else}
              <div class="text-sm text-sub">level {p.level}</div>
            {/if}
            <div class="rounded-full bg-black/30 px-2.5 py-0.5 text-xs {match.ready.includes(p.id) ? 'text-win' : 'text-sub'}">{match.ready.includes(p.id) ? "ready" : "waiting"}</div>
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
    {#if !imReady}
      <div class="mt-4 text-center text-xs text-sub">
        declining or missing the ready check takes you out of the queue{#if match.mode === "ranked"}
          · 3 declines in 10 minutes lock the queue for 5 minutes{/if}
      </div>
    {/if}
  </div>
</div>
