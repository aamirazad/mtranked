<script lang="ts">
  import { MOD_STAT_MODES, type ModStatMode, type ModStats, type ModStatsRange } from "@mtr/contracts";
  import { api } from "#lib/api.ts";
  import DailyChart from "./DailyChart.svelte";

  // Site-wide numbers for moderators: growth, activity and which features get used.
  let range = $state<ModStatsRange>("90");
  let stats = $state<ModStats | null>(null);
  let failed = $state(false);
  let userView = $state<"users" | "signups" | "active">("users");
  let testMode = $state<ModStatMode | null>(null);

  $effect(() => {
    const r = range;
    failed = false;
    void api.mod.stats({ query: { range: r } }).then((res) => {
      if (r !== range) return;
      if (res.status === 200) stats = res.body;
      else failed = true;
    });
  });

  const RANGES: { value: ModStatsRange; label: string }[] = [
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
    { value: "365", label: "1 year" },
    { value: "all", label: "all time" },
  ];
  const MODE_LABELS: Record<ModStatMode, string> = {
    ranked: "ranked",
    casual: "casual",
    ghost: "ghost races",
    private: "private rooms",
    practice: "practice",
  };
  const USER_VIEWS = { users: "total accounts", signups: "signups per day", active: "active players per day" } as const;

  const fmt = (v: number) => Math.round(v).toLocaleString();
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const days = $derived(stats?.daily.map((d) => d.date) ?? []);
  const userValues = $derived(
    stats?.daily.map((d) => (userView === "users" ? d.users : userView === "signups" ? d.signups : d.active)) ?? [],
  );
  const dayTotal = (t: Record<ModStatMode, number>) => MOD_STAT_MODES.reduce((a, m) => a + t[m], 0);
  const testValues = $derived(stats?.daily.map((d) => (testMode ? d.tests[testMode] : dayTotal(d.tests))) ?? []);
  const rangeTests = $derived(testValues.reduce((a, v) => a + v, 0));
  const maxMode = $derived(Math.max(1, ...(stats?.modes.map((m) => m.tests) ?? [])));
  const maxHour = $derived(Math.max(1, ...(stats?.hours ?? [])));
</script>

<div class="mb-6 flex flex-wrap items-center gap-1 text-sm">
  {#each RANGES as r (r.value)}
    <button class="toggle" class:on={range === r.value} onclick={() => (range = r.value)}>{r.label}</button>
  {/each}
</div>

{#if failed && !stats}
  <div class="text-sub">couldn't load stats.</div>
{:else if !stats}
  <div class="text-sub">loading…</div>
{:else}
  {@const u = stats.users}
  {@const t = stats.tests}
  <div class="space-y-6">
    <section class="card grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      <div>
        <div class="label">accounts</div>
        <div class="text-3xl tabular-nums">{fmt(u.total)}</div>
        <div class="text-xs text-sub">+{fmt(u.new7d)} this week · +{fmt(u.new1d)} today</div>
      </div>
      <div>
        <div class="label">active this week</div>
        <div class="text-3xl tabular-nums">{fmt(u.active7d)}</div>
        <div class="text-xs text-sub">{fmt(u.active1d)} today · {fmt(u.active30d)} this month</div>
      </div>
      <div>
        <div class="label">tests completed</div>
        <div class="text-3xl tabular-nums text-main">{fmt(t.total)}</div>
        <div class="text-xs text-sub">{fmt(t.last7d)} this week · {fmt(t.today)} today</div>
      </div>
      <div>
        <div class="label">time typing</div>
        <div class="text-3xl tabular-nums">{fmt(t.hoursTyped)}h</div>
        <div class="text-xs text-sub">{pct(t.fromGuests, t.total)} of tests by guests</div>
      </div>
    </section>

    <section class="card">
      <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="label text-sm">players</div>
        <div class="flex flex-wrap gap-1 text-sm">
          {#each Object.entries(USER_VIEWS) as [v, l] (v)}
            <button class="toggle" class:on={userView === v} onclick={() => (userView = v as typeof userView)}
              >{l}</button
            >
          {/each}
        </div>
      </div>
      <DailyChart {days} values={userValues} kind={userView === "users" ? "line" : "bars"} label={USER_VIEWS[userView]}>
        {#snippet tooltip(i)}
          {@const d = stats!.daily[i]!}
          <div class="flex gap-3 whitespace-nowrap" class:text-main={userView === "users"}>
            <span>accounts</span><span class="ml-auto tabular-nums">{fmt(d.users)}</span>
          </div>
          <div class="flex gap-3 whitespace-nowrap" class:text-main={userView === "signups"}>
            <span>signups</span><span class="ml-auto tabular-nums">{fmt(d.signups)}</span>
          </div>
          <div class="flex gap-3 whitespace-nowrap" class:text-main={userView === "active"}>
            <span>active</span><span class="ml-auto tabular-nums">{fmt(d.active)}</span>
          </div>
        {/snippet}
      </DailyChart>
    </section>

    <section class="card">
      <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="label text-sm">tests per day</div>
        <div class="flex flex-wrap gap-1 text-sm">
          <button class="toggle" class:on={testMode === null} onclick={() => (testMode = null)}>all</button>
          {#each MOD_STAT_MODES as m (m)}
            <button class="toggle" class:on={testMode === m} onclick={() => (testMode = m)}>{MODE_LABELS[m]}</button>
          {/each}
        </div>
        <div class="ml-auto text-xs text-sub tabular-nums">{fmt(rangeTests)} in range</div>
      </div>
      <DailyChart {days} values={testValues} label="{testMode ? MODE_LABELS[testMode] : ''} tests">
        {#snippet tooltip(i)}
          {@const d = stats!.daily[i]!}
          {#each MOD_STAT_MODES as m (m)}
            {#if !testMode || testMode === m}
              <div class="flex gap-3 whitespace-nowrap text-text">
                <span>{MODE_LABELS[m]}</span><span class="ml-auto tabular-nums">{fmt(d.tests[m])}</span>
              </div>
            {/if}
          {/each}
          {#if !testMode}
            <div class="flex gap-3 whitespace-nowrap text-main">
              <span>total</span><span class="ml-auto tabular-nums">{fmt(dayTotal(d.tests))}</span>
            </div>
          {/if}
        {/snippet}
      </DailyChart>
    </section>

    <section class="card overflow-x-auto">
      <div class="label mb-4 text-sm">features, all time</div>
      <table class="w-full text-left text-sm">
        <thead class="text-sub">
          <tr>
            <th class="py-2 font-normal">mode</th>
            <th class="w-1/3 font-normal">tests</th>
            <th class="text-right font-normal" title="separate races or rooms played">races</th>
            <th class="text-right font-normal" title="distinct signed-in players">players</th>
            <th class="text-right font-normal">last 7 days</th>
            <th class="text-right font-normal">avg wpm</th>
          </tr>
        </thead>
        <tbody>
          {#each [...stats.modes].sort((a, b) => b.tests - a.tests) as m (m.mode)}
            <tr class="border-t border-bg/60">
              <td class="py-2 whitespace-nowrap">{MODE_LABELS[m.mode]}</td>
              <td>
                <div class="flex items-center gap-3">
                  <div class="h-2 flex-1 rounded-full bg-bg/60">
                    <div class="h-2 rounded-full bg-main" style="width: {(m.tests / maxMode) * 100}%"></div>
                  </div>
                  <span class="w-20 text-right tabular-nums"
                    >{fmt(m.tests)} <span class="text-xs text-sub">{pct(m.tests, t.total)}</span></span
                  >
                </div>
              </td>
              <td class="text-right tabular-nums">{fmt(m.races)}</td>
              <td class="text-right tabular-nums">{fmt(m.players)}</td>
              <td class="text-right tabular-nums">{fmt(m.last7d)}</td>
              <td class="text-right tabular-nums">{m.tests ? fmt(m.avgWpm) : "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section class="grid gap-6 md:grid-cols-2">
      {#each [{ title: "popular test types", rows: stats.testTypes }, { title: "languages", rows: stats.languages }] as list (list.title)}
        {@const max = Math.max(1, ...list.rows.map((r) => r.tests))}
        <div class="card">
          <div class="label mb-4 text-sm">{list.title}</div>
          {#each list.rows as r (r.label)}
            <div class="mb-2 flex items-center gap-3 text-sm">
              <span class="w-28 shrink-0 truncate" title={r.label}>{r.label}</span>
              <div class="h-2 flex-1 rounded-full bg-bg/60">
                <div class="h-2 rounded-full bg-main" style="width: {(r.tests / max) * 100}%"></div>
              </div>
              <span class="w-12 text-right tabular-nums">{fmt(r.tests)}</span>
            </div>
          {:else}
            <div class="text-sm text-sub">no tests yet.</div>
          {/each}
        </div>
      {/each}
    </section>

    <section class="card">
      <div class="label mb-4 text-sm">tests by hour of day <span class="normal-case">(utc)</span></div>
      <div class="flex h-28 items-end gap-[2px]">
        {#each stats.hours as h, i (i)}
          <div
            class="group relative flex h-full flex-1 items-end"
            title="{String(i).padStart(2, '0')}:00 utc · {fmt(h)} tests"
          >
            <div
              class="w-full rounded-t-sm bg-main transition-opacity group-hover:opacity-70"
              style="height: {(h / maxHour) * 100}%"
            ></div>
          </div>
        {/each}
      </div>
      <div class="mt-1 flex justify-between text-[11px] text-sub tabular-nums">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </section>

    <section class="grid gap-6 md:grid-cols-2">
      <div class="card grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div class="label col-span-2 text-sm">accounts</div>
        <div>
          <div class="text-sub">verified email</div>
          <div class="text-xl tabular-nums">
            {fmt(u.verified)} <span class="text-xs text-sub">{pct(u.verified, u.total)}</span>
          </div>
        </div>
        <div>
          <div class="text-sub">supporters</div>
          <div class="text-xl tabular-nums">
            {fmt(u.supporters)} <span class="text-xs text-sub">{fmt(u.earlySupporters)} early</span>
          </div>
        </div>
        <div>
          <div class="text-sub">have a friend</div>
          <div class="text-xl tabular-nums">
            {fmt(u.withFriends)} <span class="text-xs text-sub">{pct(u.withFriends, u.total)}</span>
          </div>
        </div>
        <div>
          <div class="text-sub">moderators</div>
          <div class="text-xl tabular-nums">{fmt(u.moderators)}</div>
        </div>
      </div>
      <div class="card grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div class="label col-span-2 text-sm">moderation</div>
        <div>
          <div class="text-sub">open reports</div>
          <div class="text-xl tabular-nums">
            {fmt(stats.moderation.openReports)}
            <span class="text-xs text-sub">{fmt(stats.moderation.resolved30d)} resolved this month</span>
          </div>
        </div>
        <div>
          <div class="text-sub">held results</div>
          <div class="text-xl tabular-nums">{fmt(stats.moderation.held)}</div>
        </div>
        <div>
          <div class="text-sub">auto flags this week</div>
          <div class="text-xl tabular-nums">
            {fmt(stats.moderation.flags7d)} <span class="text-xs text-sub">{fmt(u.flagged)} in shadow queue</span>
          </div>
        </div>
        <div>
          <div class="text-sub">suspended</div>
          <div class="text-xl tabular-nums">
            {fmt(u.banned + u.timedOut)}
            <span class="text-xs text-sub">{fmt(u.banned)} banned · {fmt(u.timedOut)} timed out</span>
          </div>
        </div>
      </div>
    </section>
  </div>
{/if}
