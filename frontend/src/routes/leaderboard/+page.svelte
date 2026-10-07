<script lang="ts">
  import { api } from "#lib/api.ts";
  import type { LeaderboardRow } from "@mtr/contracts";
  import { COUNTRIES, flag } from "#lib/countries.ts";
  import { session } from "#lib/session.svelte.ts";
  import TierBadge from "#lib/components/TierBadge.svelte";

  let country = $state("");
  let rows = $state<LeaderboardRow[] | null>(null);
  let season = $state<{ name: string; endsAt: string } | null>(null);

  $effect(() => {
    const c = country;
    rows = null;
    void api.leaderboard({ query: c ? { country: c } : {} }).then((r) => {
      if (r.status === 200 && c === country) {
        rows = r.body.rows;
        season = r.body.season;
      }
    });
  });
  const daysLeft = $derived(season ? Math.max(0, Math.ceil((new Date(season.endsAt).getTime() - Date.now()) / 86400_000)) : 0);
</script>

<svelte:head><title>leaderboard · mt ranked</title></svelte:head>

<div class="mx-auto max-w-[900px] animate-fade">
  <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="font-logo text-4xl">leaderboard</h1>
      <div class="mt-1 text-sm text-sub">{season ? `${season.name} · ends in ${daysLeft} days · top 100 placed players` : " "}</div>
    </div>
    <select class="input w-56" bind:value={country} aria-label="filter by country">
      <option value="">all countries</option>
      {#each COUNTRIES as c (c.code)}<option value={c.code}>{flag(c.code)} {c.name}</option>{/each}
    </select>
  </div>

  {#if rows === null}
    <div class="text-sub">loading…</div>
  {:else if rows.length === 0}
    <div class="card text-center text-sub">nobody has finished placements{country ? " in this country" : ""} yet. <a class="link" href="/play/ranked">be the first</a>.</div>
  {:else}
    <table class="w-full text-left">
      <thead class="text-sm text-sub">
        <tr><th class="py-2 font-normal">#</th><th class="font-normal">player</th><th class="font-normal">tier</th><th class="text-right font-normal">rating</th><th class="text-right font-normal">w / l</th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr class="border-t border-sub-alt transition-colors hover:bg-sub-alt/50" class:text-main={r.id === session.me?.id}>
            <td class="py-2.5 tabular-nums {r.rank <= 3 ? 'text-main' : 'text-sub'}">{r.rank}</td>
            <td><a href="/u/{r.name}" class="hover:underline">{flag(r.country)} {r.name}</a>{#if r.subscriber}<span class="ml-2 text-xs text-main" title="supporter">♥</span>{/if}</td>
            <td><TierBadge rating={r.rating} showRating={false} /></td>
            <td class="text-right tabular-nums">{r.rating}</td>
            <td class="text-right text-sm tabular-nums text-sub">{r.wins} / {r.races - r.wins}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
