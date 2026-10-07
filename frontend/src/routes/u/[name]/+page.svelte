<script lang="ts">
  import { page } from "$app/state";
  import { Play } from "@lucide/svelte";
  import type { MatchSummary, Profile } from "@mtr/contracts";
  import { tierFor, levelFromXp, PLACEMENT_RACES } from "@mtr/shared";
  import { api } from "#lib/api.ts";
  import { flag } from "#lib/countries.ts";
  import TierBadge from "#lib/components/TierBadge.svelte";

  const name = $derived(page.params.name ?? "");
  let profile = $state<Profile | null>(null);
  let missing = $state(false);
  let matches = $state<MatchSummary[]>([]);
  let more = $state(false);
  let limited = $state(false);

  $effect(() => {
    const n = name;
    profile = null;
    missing = false;
    matches = [];
    void api.users.profile({ params: { name: n } }).then((r) => {
      if (r.status === 200) profile = r.body.profile;
      else missing = true;
    });
    void loadMatches(n, 0);
  });

  async function loadMatches(n: string, offset: number) {
    const r = await api.users.matches({ params: { name: n }, query: { offset } });
    if (r.status !== 200) return;
    matches = offset ? [...matches, ...r.body.matches] : r.body.matches;
    more = r.body.more;
    limited = r.body.limited;
  }

  const lvl = $derived(profile ? levelFromXp(profile.xp) : null);
  const placed = $derived(!!profile && profile.races >= PLACEMENT_RACES);
  const stats = $derived(
    profile
      ? [
          ["ranked w/l", `${profile.wins} / ${profile.losses}`],
          ["placements", placed ? "done" : `${profile.races}/${PLACEMENT_RACES}`],
          ["avg wpm", String(profile.stats.avgWpm)],
          ["best wpm", String(profile.stats.bestWpm)],
          ["avg acc", `${profile.stats.avgAcc}%`],
        ]
      : [],
  );
  const ago = (iso: string) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
</script>

<svelte:head><title>{name} · mt ranked</title></svelte:head>

{#if missing}
  <div class="pt-16 text-center text-sub">no player called “{name}”.</div>
{:else if !profile}
  <div class="pt-16 text-center text-sub">loading…</div>
{:else}
  <div class="mx-auto max-w-[1000px] animate-fade">
    <div class="rounded-2xl p-8" style="background: {profile.banner}">
      <div class="flex flex-wrap items-center gap-8">
        <TierBadge rating={profile.rating} races={profile.races} size="lg" showRating={false} />
        <div class="min-w-0">
          <div class="flex items-center gap-3 text-4xl">
            <span class="truncate">{profile.name}</span>
            {#if profile.country}<span class="text-2xl" title={profile.country}>{flag(profile.country)}</span>{/if}
            {#if profile.subscriber}<span class="rounded bg-main px-2 py-0.5 text-xs text-bg">supporter</span>{/if}
          </div>
          <div class="mt-2 flex items-center gap-3 text-sm text-sub">
            <span>level <span class="text-text">{lvl?.level}</span></span>
            <div class="h-1.5 w-32 overflow-hidden rounded bg-bg/60">
              <div class="h-full bg-main" style="width: {lvl ? (lvl.into / lvl.need) * 100 : 0}%"></div>
            </div>
            <span>joined {new Date(profile.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="ml-auto grid grid-cols-3 gap-8 text-center">
          <div>
            <div class="label">rating</div>
            <div class="text-3xl" style="color: {placed ? tierFor(profile.rating).color : 'inherit'}">{placed ? profile.rating : "—"}</div>
          </div>
          <div><div class="label">season peak</div><div class="text-3xl">{profile.peak || "—"}</div></div>
          <div>
            <div class="label">win rate</div>
            <div class="text-3xl">{profile.races ? Math.round((profile.wins / profile.races) * 100) + "%" : "—"}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
      {#each stats as [l, v] (l)}
        <div class="card py-4"><div class="label">{l}</div><div class="mt-1 text-2xl text-main">{v}</div></div>
      {/each}
    </div>

    {#if profile.seasons.some((s) => !s.current && s.peak > 0)}
      <div class="mt-8">
        <div class="label mb-3">season badges</div>
        <div class="flex flex-wrap gap-3">
          {#each profile.seasons.filter((s) => !s.current && s.peak > 0) as s (s.seasonId)}
            <div class="card flex items-center gap-3 py-3" title="{s.name}: peak {s.peak}">
              <TierBadge rating={s.peak} showRating={false} />
              <span class="text-xs text-sub">{s.name}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="mt-10">
      <div class="label mb-3">match history</div>
      {#if matches.length === 0}
        <div class="text-sub">no races yet.</div>
      {:else}
        <table class="w-full text-left text-sm">
          <thead class="text-sub">
            <tr>
              <th class="py-2 font-normal">result</th>
              <th class="font-normal">mode</th>
              <th class="font-normal">opponent</th>
              <th class="text-right font-normal">wpm</th>
              <th class="text-right font-normal">acc</th>
              <th class="text-right font-normal">rating</th>
              <th class="text-right font-normal">when</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each matches as m (m.matchId)}
              <tr class="border-t border-sub-alt">
                <td class="py-2.5">
                  {#if m.players === 1}<span class="text-sub">solo</span>
                  {:else if m.placement === 1}<span class="text-win">{m.players > 2 ? "#1" : "win"}</span>
                  {:else}<span class="text-error">{m.players > 2 ? `#${m.placement}` : "loss"}</span>{/if}
                  {#if m.status === "held"}<span class="ml-1 text-xs text-sub">(review)</span>{/if}
                  {#if m.status === "void"}<span class="ml-1 text-xs text-sub">(void)</span>{/if}
                </td>
                <td class="text-sub">{m.mode}</td>
                <td>{#if m.opponent}{m.opponent}{:else if m.players > 2}<span class="text-sub">{m.players} players</span>{/if}</td>
                <td class="text-right tabular-nums">{Math.round(m.wpm)}</td>
                <td class="text-right tabular-nums text-sub">{Math.round(m.acc)}%</td>
                <td class="text-right tabular-nums {m.delta === null ? 'text-sub' : m.delta >= 0 ? 'text-win' : 'text-error'}">
                  {m.delta === null ? "—" : `${m.delta >= 0 ? "+" : ""}${Math.round(m.delta)}`}
                </td>
                <td class="text-right text-sub">{ago(m.finishedAt)}</td>
                <td class="text-right"><a href="/replay/{m.matchId}" class="inline-flex text-sub hover:text-main" title="replay"><Play size={14} /></a></td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if more}<button class="btn btn-ghost mt-4" onclick={() => loadMatches(name, matches.length)}>load more</button>{/if}
        {#if limited}<div class="mt-4 text-xs text-sub">free accounts keep their last 50 races. supporters keep everything.</div>{/if}
      {/if}
    </div>
  </div>
{/if}
