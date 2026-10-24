<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Search, X } from "@lucide/svelte";
  import { api } from "#lib/api.ts";
  import type { LeaderboardRow, PlayerHit, Profile } from "@mtr/contracts";
  import { PLACEMENT_RACES, tierFor } from "@mtr/shared";
  import { COUNTRIES, flag } from "#lib/countries.ts";
  import { session } from "#lib/session.svelte.ts";
  import TierBadge from "#lib/components/TierBadge.svelte";
  import EloChart from "#lib/components/EloChart.svelte";
  import MatchHistory from "#lib/components/MatchHistory.svelte";

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

  // player search; the chosen player lives in ?player= so the view can be shared
  let q = $state("");
  let hits = $state<PlayerHit[]>([]);
  let open = $state(false);
  let active = $state(0);
  $effect(() => {
    const term = q.trim();
    if (!term) {
      hits = [];
      return;
    }
    const t = setTimeout(() => {
      void api.users.search({ query: { q: term } }).then((r) => {
        if (r.status === 200 && term === q.trim()) {
          hits = r.body.players;
          active = 0;
        }
      });
    }, 150);
    return () => clearTimeout(t);
  });

  const selected = $derived(page.url.searchParams.get("player"));
  let player = $state<Profile | null>(null);
  let playerMissing = $state(false);
  $effect(() => {
    const n = selected;
    player = null;
    playerMissing = false;
    if (!n) return;
    void api.users.profile({ params: { name: n } }).then((r) => {
      if (n !== selected) return;
      if (r.status === 200) player = r.body.profile;
      else playerMissing = true;
    });
  });
  const placed = $derived(!!player && player.races >= PLACEMENT_RACES);

  function choose(name: string | null) {
    q = "";
    hits = [];
    open = false;
    const url = new URL(page.url.href);
    if (name) url.searchParams.set("player", name);
    else url.searchParams.delete("player");
    void goto(url, { replace: true, reset: false });
  }
  function onsearchkey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" && hits.length) active = (active + 1) % hits.length;
    else if (e.key === "ArrowUp" && hits.length) active = (active - 1 + hits.length) % hits.length;
    else if (e.key === "Enter" && hits[active]) choose(hits[active].name);
    else if (e.key === "Escape") open = false;
    else return;
    e.preventDefault();
  }

  const daysLeft = $derived(
    season ? Math.max(0, Math.ceil((new Date(season.endsAt).getTime() - Date.now()) / 86400_000)) : 0,
  );
</script>

<svelte:head><title>Leaderboard · MT Ranked</title></svelte:head>

<div class="mx-auto max-w-[900px] animate-fade">
  <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="font-logo text-4xl">leaderboard</h1>
      <div class="mt-1 text-sm text-sub">
        {season ? `${season.name} · ends in ${daysLeft} days · top 100 placed players` : " "}
      </div>
    </div>
    <div class="flex flex-wrap gap-3">
      <div class="relative w-56">
        <Search size={14} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sub" />
        <input
          class="input pl-8"
          placeholder="find a player"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="player-hits"
          aria-activedescendant={open && hits[active] ? `hit-${active}` : undefined}
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck="false"
          maxlength="20"
          bind:value={q}
          oninput={() => (open = true)}
          onfocus={() => (open = true)}
          onblur={() => (open = false)}
          onkeydown={onsearchkey}
        />
        {#if open && q.trim() && hits.length}
          <div
            id="player-hits"
            role="listbox"
            class="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-sub-alt py-1 shadow-lg"
          >
            {#each hits as h, i (h.name)}
              <button
                type="button"
                tabindex="-1"
                id="hit-{i}"
                role="option"
                aria-selected={i === active}
                class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm {i === active
                  ? 'bg-bg/60 text-text'
                  : 'text-sub'}"
                onmousedown={(e) => e.preventDefault()}
                onmouseenter={() => (active = i)}
                onclick={() => choose(h.name)}
              >
                <span class="truncate">{flag(h.country)} {h.name}</span>
                <TierBadge rating={h.rating} races={h.races} size="sm" showRating={false} />
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <select class="input w-56" bind:value={country} aria-label="filter by country">
        <option value="">all countries</option>
        {#each COUNTRIES as c (c.code)}<option value={c.code}>{flag(c.code)} {c.name}</option>{/each}
      </select>
    </div>
  </div>

  {#if selected}
    <section class="card mb-8 animate-fade bg-transparent p-0" aria-label="player details">
      {#if playerMissing}
        <div class="card flex items-center justify-between text-sub">
          no player called “{selected}”.
          <button class="btn btn-ghost px-2" title="close" onclick={() => choose(null)}><X size={16} /></button>
        </div>
      {:else if !player}
        <div class="card text-sub">loading…</div>
      {:else}
        <div class="card flex flex-wrap items-center gap-6">
          <TierBadge rating={player.rating} races={player.races} size="lg" showRating={false} />
          <div class="min-w-0">
            <a href="/u/{player.name}" class="flex items-center gap-2 text-2xl hover:underline">
              <span class="truncate">{player.name}</span>
              {#if player.country}<span class="text-lg">{flag(player.country)}</span>{/if}
            </a>
            <a href="/u/{player.name}" class="link text-xs">full profile →</a>
          </div>
          <div class="ml-auto grid grid-cols-4 gap-6 text-center">
            <div>
              <div class="label">rating</div>
              <div class="text-2xl tabular-nums" style="color: {placed ? tierFor(player.rating).color : 'inherit'}">
                {placed ? player.rating : "—"}
              </div>
            </div>
            <div>
              <div class="label">peak</div>
              <div class="text-2xl tabular-nums">{player.peak || "—"}</div>
            </div>
            <div>
              <div class="label">w / l</div>
              <div class="text-2xl tabular-nums">{player.wins} / {player.losses}</div>
            </div>
            <div>
              <div class="label">win rate</div>
              <div class="text-2xl tabular-nums">
                {player.races ? Math.round((player.wins / player.races) * 100) + "%" : "—"}
              </div>
            </div>
          </div>
          <button class="btn btn-ghost self-start px-2" title="close" onclick={() => choose(null)}
            ><X size={16} /></button
          >
        </div>
        <div class="mt-4"><EloChart name={player.name} /></div>
        <div class="mt-6"><MatchHistory name={player.name} /></div>
      {/if}
    </section>
  {/if}

  {#if rows === null}
    <div class="text-sub">loading…</div>
  {:else if rows.length === 0}
    <div class="card text-center text-sub">
      nobody has finished placements{country ? " in this country" : ""} yet.
      <a class="link" href="/play/ranked">be the first</a>.
    </div>
  {:else}
    <table class="w-full border-separate border-spacing-0 text-left">
      <thead class="text-sm text-sub">
        <tr
          ><th class="py-2 pl-3 font-normal">#</th><th class="font-normal">player</th><th class="font-normal">tier</th
          ><th class="text-right font-normal">rating</th><th class="pr-3 text-right font-normal">w / l</th></tr
        >
      </thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr
            class="[&>td]:border-t [&>td]:border-sub-alt [&:hover>td]:border-transparent [&:hover+tr>td]:border-transparent [&:hover>td]:bg-sub-alt/50 [&>td]:transition-colors [&>td:first-child]:rounded-l-lg [&>td:first-child]:pl-3 [&>td:last-child]:rounded-r-lg [&>td:last-child]:pr-3"
            class:text-main={r.id === session.me?.id}
          >
            <td class="py-2.5 tabular-nums {r.rank <= 3 ? 'text-main' : 'text-sub'}">{r.rank}</td>
            <td
              ><a href="/u/{r.name}" class="hover:underline">{flag(r.country)} {r.name}</a
              >{#if r.subscriber && session.supporterSales}<span class="ml-2 text-xs text-main" title="supporter"
                  >♥</span
                >{/if}</td
            >
            <td><TierBadge rating={r.rating} showRating={false} /></td>
            <td class="text-right tabular-nums">{r.rating}</td>
            <td class="text-right text-sm tabular-nums text-sub">{r.wins} / {r.races - r.wins}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
