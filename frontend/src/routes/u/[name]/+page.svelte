<script lang="ts">
  import { page } from "$app/state";
  import type { Profile } from "@mtr/contracts";
  import { tierFor, levelFromXp, PLACEMENT_RACES } from "@mtr/shared";
  import { api } from "#lib/api.ts";
  import { flag } from "#lib/countries.ts";
  import TierBadge from "#lib/components/TierBadge.svelte";
  import EloChart from "#lib/components/EloChart.svelte";
  import MatchHistory from "#lib/components/MatchHistory.svelte";

  const name = $derived(page.params.name ?? "");
  let profile = $state<Profile | null>(null);
  let missing = $state(false);

  $effect(() => {
    const n = name;
    profile = null;
    missing = false;
    void api.users.profile({ params: { name: n } }).then((r) => {
      if (r.status === 200) profile = r.body.profile;
      else missing = true;
    });
  });

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
</script>

<svelte:head><title>{name} · MT Ranked</title></svelte:head>

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

    <div class="mt-6"><EloChart name={profile.name} /></div>

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

    <div class="mt-10"><MatchHistory {name} /></div>
  </div>
{/if}
