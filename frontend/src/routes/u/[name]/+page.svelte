<script lang="ts">
  import { dimBanner } from "#lib/banner.ts";
  import { page } from "$app/state";
  import { Check, Flame, Trophy, TrendingDown, TrendingUp, UserPlus } from "@lucide/svelte";
  import type { PersonalBest, Profile, ProfileStats, StatKind } from "@mtr/contracts";
  import { tierFor, levelFromXp, PLACEMENT_RACES } from "@mtr/shared";
  import { api } from "#lib/api.ts";
  import { flag } from "#lib/countries.ts";
  import { session } from "#lib/session.svelte.ts";
  import { friends } from "#lib/friends.svelte.ts";
  import { fmtDate, hms, ordinal } from "#lib/format.ts";
  import TierBadge from "#lib/components/TierBadge.svelte";
  import EloChart from "#lib/components/EloChart.svelte";
  import MatchHistory from "#lib/components/MatchHistory.svelte";
  import WpmHistoryChart from "#lib/components/WpmHistoryChart.svelte";
  import ActivityHeatmap from "#lib/components/ActivityHeatmap.svelte";

  const name = $derived(page.params.name ?? "");
  let profile = $state<Profile | null>(null);
  let stats = $state<ProfileStats | null>(null);
  let missing = $state(false);
  let addError = $state<string | null>(null);
  async function addFriend() {
    const r = await friends.add(profile!.name);
    addError = r.ok ? null : r.text;
  }
  let kind = $state<StatKind | null>(null);

  $effect(() => {
    const n = name;
    profile = null;
    stats = null;
    missing = false;
    void api.users.profile({ params: { name: n } }).then((r) => {
      if (n !== name) return;
      if (r.status === 200) profile = r.body.profile;
      else missing = true;
    });
    void api.users.stats({ params: { name: n } }).then((r) => {
      if (n === name && r.status === 200) stats = r.body.stats;
    });
  });

  const friendStatus = $derived.by(() => {
    const id = profile?.id;
    const l = friends.list;
    if (!id || !l || !session.me || id === session.me.id) return null;
    if (l.friends.some((f) => f.id === id)) return "friends";
    if (l.incoming.some((f) => f.id === id)) return "incoming";
    if (l.outgoing.some((f) => f.id === id)) return "outgoing";
    return "none";
  });

  const lvl = $derived(profile ? levelFromXp(profile.xp) : null);
  const placed = $derived(!!profile && profile.races >= PLACEMENT_RACES);
  const tierColor = $derived(profile && placed ? tierFor(profile.rating).color : "var(--color-sub)");
  const k = (n: number) =>
    n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  // a kind with nothing in it isn't worth a tab
  const kinds = $derived((stats?.kinds ?? []).filter((x) => x.results > 0));
  const sel = $derived.by(() => {
    if (!stats) return null;
    if (kind) return stats.kinds.find((x) => x.kind === kind) ?? null;
    // "all": combine the kinds, weighting averages by completed results
    const ks = stats.kinds;
    const done = ks.reduce((a, x) => a + x.completed, 0);
    const w = (f: (x: (typeof ks)[number]) => number) =>
      done ? ks.reduce((a, x) => a + f(x) * x.completed, 0) / done : 0;
    const withCons = ks.filter((x) => x.avgConsistency !== null);
    const consDone = withCons.reduce((a, x) => a + x.completed, 0);
    return {
      kind: null,
      results: stats.totals.results,
      completed: done,
      versus: ks.reduce((a, x) => a + x.versus, 0),
      wins: ks.reduce((a, x) => a + x.wins, 0),
      avgWpm: w((x) => x.avgWpm),
      bestWpm: Math.max(0, ...ks.map((x) => x.bestWpm)),
      avgAcc: w((x) => x.avgAcc),
      avgConsistency: consDone ? withCons.reduce((a, x) => a + x.avgConsistency! * x.completed, 0) / consDone : null,
      last10Wpm: null,
      timeMs: stats.totals.timeMs,
    };
  });
  const trend = $derived(sel?.last10Wpm != null && sel.avgWpm ? sel.last10Wpm - sel.avgWpm : null);

  const pbGroups = $derived(
    stats
      ? [
          { unit: "seconds", entries: Object.entries(stats.pbs.time) },
          { unit: "words", entries: Object.entries(stats.pbs.words) },
        ]
      : [],
  );
  const pbDetail = (p: PersonalBest) =>
    [p.kind, p.language.replace("_", " "), p.punctuation ? "punctuation" : "", p.numbers ? "numbers" : ""]
      .filter(Boolean)
      .join(" · ");
</script>

<svelte:head><title>{name} · MT Ranked</title></svelte:head>

{#if missing}
  <div class="pt-16 text-center text-sub">no player called “{name}”.</div>
{:else if !profile}
  <div class="pt-16 text-center text-sub">loading…</div>
{:else}
  <div class="mx-auto flex max-w-[1100px] flex-col gap-6 animate-fade">
    <!-- banner, dimmed toward the theme background so it frames the panel instead of shouting -->
    <section class="banner overflow-hidden rounded-2xl p-3 sm:p-4" style="background: {dimBanner(profile.banner, 50)}">
      <div class="banner-panel grid items-center gap-6 !px-5 !py-5 md:grid-cols-[minmax(0,auto)_1px_minmax(0,1fr)]">
        <div class="flex min-w-0 flex-col gap-4">
          <div class="flex min-w-0 items-center gap-4">
            <div class="relative flex-none">
              <div
                class="flex h-20 w-20 items-center justify-center rounded-full font-logo text-4xl text-bg uppercase shadow-lg sm:h-24 sm:w-24"
                style="background: radial-gradient(circle at 30% 25%, color-mix(in srgb, {tierColor} 65%, white), {tierColor} 70%); box-shadow: 0 0 0 3px color-mix(in srgb, {tierColor} 35%, transparent)"
                aria-hidden="true"
              >
                {profile.name.slice(0, 1)}
              </div>
              <div class="absolute -right-1 -bottom-1 rounded-full bg-bg/80 p-1 backdrop-blur">
                <TierBadge rating={profile.rating} races={profile.races} size="sm" showRating={false} />
              </div>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 text-3xl sm:text-4xl">
                <span class="truncate" title={profile.name}>{profile.name}</span>
                {#if profile.country}<span class="text-2xl" title={profile.country}>{flag(profile.country)}</span>{/if}
              </div>
              <div class="mt-1 text-xs text-sub">joined {fmtDate(profile.createdAt)}</div>
              {#if stats}
                <div class="text-xs text-sub">
                  {#if stats.streak.current}
                    <span class="inline-flex items-center gap-1"
                      ><Flame size={12} class="text-main" />current streak {stats.streak.current}
                      {stats.streak.current === 1 ? "day" : "days"}</span
                    >
                  {:else if stats.streak.best}
                    best streak {stats.streak.best} {stats.streak.best === 1 ? "day" : "days"}
                  {/if}
                </div>
              {/if}
              {#if profile.subscriber && session.supporterSales}<span
                  class="mt-1 inline-block rounded bg-main px-2 py-0.5 text-xs text-bg">supporter</span
                >{/if}
              {#if friendStatus === "none"}
                <button class="mt-2 flex items-center gap-1.5 text-sm text-sub hover:text-main" onclick={addFriend}
                  ><UserPlus size={14} /> add friend</button
                >
                {#if addError}<div class="mt-1 text-xs text-error">{addError}</div>{/if}
              {:else if friendStatus === "incoming"}
                <button
                  class="mt-2 flex items-center gap-1.5 text-sm text-main hover:text-text"
                  onclick={() => friends.accept(profile!)}><Check size={14} /> accept friend request</button
                >
              {:else if friendStatus === "outgoing"}
                <div class="mt-2 text-sm text-sub">friend request sent</div>
              {:else if friendStatus === "friends"}
                <a href="/friends" class="mt-2 flex items-center gap-1.5 text-sm text-sub hover:text-text"
                  ><Check size={14} /> friends</a
                >
              {/if}
            </div>
          </div>
          {#if lvl}
            <div class="flex items-center gap-3 text-sm" title="{lvl.into} / {lvl.need} xp to level {lvl.level + 1}">
              <span class="tabular-nums">{lvl.level}</span>
              <div class="h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-black/30">
                <div
                  class="h-full rounded-full bg-main transition-[width] duration-700"
                  style="width: {(lvl.into / lvl.need) * 100}%"
                ></div>
              </div>
              <span class="text-xs whitespace-nowrap text-sub tabular-nums">{k(lvl.into)}/{k(lvl.need)}</span>
            </div>
          {/if}
        </div>
        <div class="hidden h-full w-px rounded bg-white/10 md:block"></div>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <div class="label sm:text-sm">races</div>
            <div class="text-2xl tabular-nums sm:text-4xl">
              {stats ? stats.kinds.filter((x) => x.kind !== "practice").reduce((a, x) => a + x.results, 0) : "—"}
            </div>
          </div>
          <div>
            <div class="label sm:text-sm">tests completed</div>
            <div class="text-2xl tabular-nums sm:text-4xl">{stats?.totals.completed ?? "—"}</div>
          </div>
          <div>
            <div class="label sm:text-sm">time typing</div>
            <div class="text-2xl tabular-nums sm:text-4xl">{stats ? hms(stats.totals.timeMs) : "—"}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ranked -->
    <section
      class="card grid grid-cols-2 items-center gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-[auto_repeat(5,minmax(0,1fr))]"
    >
      <div class="col-span-2 sm:col-span-3 lg:col-span-1 lg:pr-4">
        <TierBadge rating={profile.rating} races={profile.races} size="lg" />
        {#if !placed}<div class="mt-1 text-xs text-sub">
            {PLACEMENT_RACES - profile.races} placement {PLACEMENT_RACES - profile.races === 1 ? "race" : "races"} left
          </div>{/if}
      </div>
      <div>
        <div class="label">season ladder</div>
        {#if stats?.ranked.rank}
          <div class="text-2xl tabular-nums">{ordinal(stats.ranked.rank)}</div>
          <div class="text-xs text-sub">
            top {Math.max(0.01, Math.round((stats.ranked.rank / Math.max(1, stats.ranked.ladder)) * 10000) / 100)}%
          </div>
        {:else}
          <div class="text-2xl text-sub">—</div>
        {/if}
      </div>
      <div>
        <div class="label">season peak</div>
        <div class="text-2xl tabular-nums">{profile.peak || "—"}</div>
      </div>
      <div>
        <div class="label">all-time peak</div>
        <div
          class="text-2xl tabular-nums"
          style="color: {stats?.ranked.allTimePeak ? tierFor(stats.ranked.allTimePeak).color : 'inherit'}"
        >
          {stats?.ranked.allTimePeak || "—"}
        </div>
      </div>
      <div>
        <div class="label">season w/l</div>
        <div class="text-2xl tabular-nums">{profile.wins}<span class="text-sub">/</span>{profile.losses}</div>
        <div class="text-xs text-sub">{pct(profile.wins, profile.races)} win rate</div>
      </div>
      <div>
        <div class="label">win streak</div>
        <div class="text-2xl tabular-nums">{stats?.ranked.winStreak ?? "—"}</div>
        <div class="text-xs text-sub">best {stats?.ranked.bestWinStreak ?? 0}</div>
      </div>
    </section>

    <!-- personal bests -->
    {#if stats}
      <section class="grid gap-6 lg:grid-cols-2">
        {#each pbGroups as g (g.unit)}
          <div class="card grid grid-cols-4 gap-2 px-3">
            {#each g.entries as [len, p] (len)}
              <div
                class="group relative min-h-28 rounded-lg px-1 py-1 text-center"
                title={p ? `${len} ${g.unit}: ${Math.round(p.wpm)} wpm, ${Math.round(p.acc)}% accuracy` : undefined}
              >
                <div class="text-xs text-sub">{len} {g.unit}</div>
                <div class="transition-opacity duration-150 group-hover:opacity-0">
                  <div class="text-4xl leading-tight tabular-nums sm:text-5xl">{p ? Math.round(p.wpm) : "-"}</div>
                  <div class="text-xl text-sub tabular-nums sm:text-2xl">{p ? `${Math.round(p.acc)}%` : "-"}</div>
                </div>
                {#if p}
                  <div
                    class="absolute inset-x-0 top-5 bottom-0 flex flex-col items-center justify-center gap-0.5 rounded-lg text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  >
                    <div class="text-sm text-text tabular-nums">{p.wpm} wpm</div>
                    <div class="text-sub tabular-nums">{p.raw} raw</div>
                    <div class="text-sub tabular-nums">{p.acc}% acc</div>
                    {#if p.consistency !== null}<div class="text-sub tabular-nums">
                        {Math.round(p.consistency)}% con
                      </div>{/if}
                    <div class="text-sub">{fmtDate(p.at)}</div>
                    <div class="max-w-full truncate text-[10px] text-sub/80" title={pbDetail(p)}>{pbDetail(p)}</div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </section>
    {/if}

    <!-- per-mode stats -->
    {#if stats && stats.totals.results > 0}
      <section class="card">
        <div class="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="label text-sm">stats</div>
          <div class="flex flex-wrap gap-1 text-sm">
            <button class="toggle" class:on={kind === null} onclick={() => (kind = null)}>all</button>
            {#each kinds as x (x.kind)}
              <button class="toggle" class:on={kind === x.kind} onclick={() => (kind = x.kind)}
                >{x.kind === "private" ? "private rooms" : x.kind}</button
              >
            {/each}
          </div>
        </div>
        {#if sel}
          <div class="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <div>
              <div class="label">{sel.kind === "practice" ? "tests" : "results"}</div>
              <div class="text-3xl tabular-nums">{sel.results}</div>
              <div class="text-xs text-sub">{hms(sel.timeMs)} typing</div>
            </div>
            <div>
              <div class="label">win rate</div>
              <div class="text-3xl tabular-nums">{sel.versus ? pct(sel.wins, sel.versus) : "—"}</div>
              <div class="text-xs text-sub">
                {sel.versus ? `${sel.wins} of ${sel.versus} races` : "no head-to-head races"}
              </div>
            </div>
            <div>
              <div class="label">avg wpm</div>
              <div class="text-3xl text-main tabular-nums">{Math.round(sel.avgWpm)}</div>
              {#if sel.last10Wpm !== null}
                <div class="flex items-center gap-1 text-xs text-sub">
                  last 10: <span class="tabular-nums text-text">{Math.round(sel.last10Wpm)}</span>
                  {#if trend !== null && Math.abs(trend) >= 1}
                    {#if trend > 0}<TrendingUp size={13} class="text-win" />{:else}<TrendingDown
                        size={13}
                        class="text-error"
                      />{/if}
                  {/if}
                </div>
              {/if}
            </div>
            <div>
              <div class="label">best wpm</div>
              <div class="flex items-center gap-2 text-3xl tabular-nums">
                {Math.round(sel.bestWpm)}<Trophy size={18} class="text-main" />
              </div>
            </div>
            <div>
              <div class="label">avg accuracy</div>
              <div class="text-3xl tabular-nums">{Math.round(sel.avgAcc * 10) / 10}%</div>
            </div>
            <div>
              <div class="label">avg consistency</div>
              <div class="text-3xl tabular-nums">
                {sel.avgConsistency === null ? "—" : `${Math.round(sel.avgConsistency)}%`}
              </div>
            </div>
            <div>
              <div class="label">completed</div>
              <div class="text-3xl tabular-nums">{pct(sel.completed, sel.results)}</div>
              <div class="text-xs text-sub">{sel.results - sel.completed} unfinished</div>
            </div>
          </div>
        {/if}
        <div class="mt-6">
          <div class="mb-2 flex items-center gap-4 text-xs text-sub">
            <span class="label">wpm history</span>
            <span class="ml-auto inline-flex items-center gap-1.5"
              ><span class="inline-block h-2 w-2 rounded-full bg-sub"></span>result</span
            >
            <span class="inline-flex items-center gap-1.5"
              ><span class="inline-block h-0.5 w-4 rounded bg-main"></span>10-result average</span
            >
          </div>
          <WpmHistoryChart {name} {kind} />
        </div>
      </section>
    {/if}

    <EloChart name={profile.name} />

    {#if profile.seasons.some((s) => !s.current && s.peak > 0)}
      <section>
        <div class="label mb-3">season badges</div>
        <div class="flex flex-wrap gap-3">
          {#each profile.seasons.filter((s) => !s.current && s.peak > 0) as s (s.seasonId)}
            <div class="card flex items-center gap-3 py-3" title="{s.name}: peak {s.peak}">
              <TierBadge rating={s.peak} showRating={false} />
              <span class="text-xs text-sub">{s.name}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <ActivityHeatmap {name} />

    <section class="mt-4"><MatchHistory {name} /></section>
  </div>
{/if}
