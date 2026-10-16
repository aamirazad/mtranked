// Profile statistics, all derived from server-scored results (the user_results view:
// finished races plus server-replayed practice tests).
import type { ActivityDay, KindStats, PersonalBest, ProfileStats, StatKind, WpmPoint } from "@mtr/contracts";
import { sql, currentSeason, getRating, isPlaced } from "@mtr/db";

const PB_TIMES = ["15", "30", "60", "120"];
const PB_WORDS = ["10", "25", "50", "100"];
const KINDS: StatKind[] = ["ranked", "casual", "private", "practice"];
const WPM_HISTORY_POINTS = 300;
const DAY = 86_400_000;

export type StatsUser = { id: string; created_at: Date; is_bot: boolean; flagged_at?: Date | null };

const round1 = (n: number) => Math.round(n * 10) / 10;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Current and best run of consecutive UTC days, from distinct days sorted newest first. */
export function dayStreaks(days: string[], today = new Date()): { current: number; best: number } {
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  let latestRun: number | null = null;
  for (const d of days) {
    const t = Date.parse(d);
    if (prev !== null && prev - t === DAY) run++;
    else {
      if (prev !== null) latestRun ??= run;
      run = 1;
    }
    best = Math.max(best, run);
    prev = t;
  }
  latestRun ??= run;
  // the latest run only counts as current if it reaches today or yesterday
  const latest = days[0] ? Date.parse(days[0]) : null;
  const current = latest !== null && Date.parse(isoDay(today)) - latest <= DAY ? latestRun : 0;
  return { current, best };
}

export async function profileStats(u: StatsUser): Promise<ProfileStats> {
  const season = await currentSeason();
  const [kindRows, pbRows, dayRows, streakRows, peakRow, rating] = await Promise.all([
    sql`
      select kind, count(*)::int results, (count(*) filter (where finished))::int completed,
        (count(*) filter (where players > 1))::int versus,
        (count(*) filter (where players > 1 and placement = 1 and not forfeit))::int wins,
        coalesce(avg(wpm) filter (where finished), 0)::float8 avg_wpm,
        coalesce(max(wpm) filter (where finished), 0)::float8 best_wpm,
        coalesce(avg(accuracy) filter (where finished), 0)::float8 avg_acc,
        (avg(consistency) filter (where finished))::float8 avg_cons,
        (avg(wpm) filter (where finished and rn <= 10))::float8 last10,
        coalesce(sum(duration_ms), 0)::float8 time_ms
      from (select *, row_number() over (partition by kind, finished order by at desc) rn
            from user_results where user_id = ${u.id}) t
      group by kind`,
    sql`
      select distinct on (tmode, tlen) tmode, tlen, wpm, raw, accuracy, consistency, at, kind, match_id,
        settings->>'language' as language,
        coalesce((settings->>'punctuation')::boolean, false) punctuation,
        coalesce((settings->>'numbers')::boolean, false) numbers
      from (select *, settings->>'mode' tmode,
              case settings->>'mode' when 'time' then settings->>'time' else settings->>'words' end tlen
            from user_results
            where user_id = ${u.id} and finished and settings->>'mode' in ('time', 'words')
              and settings->'funbox' is null and settings->'rules' is null) t
      where (tmode = 'time' and tlen in ${sql(PB_TIMES)}) or (tmode = 'words' and tlen in ${sql(PB_WORDS)})
      order by tmode, tlen, wpm desc, at`,
    sql<{ d: string }[]>`
      select distinct to_char(at at time zone 'UTC', 'YYYY-MM-DD') d from user_results
      where user_id = ${u.id} order by d desc`,
    // ranked win streaks: runs of wins (gaps and islands over the ranked results in order)
    sql`
      select coalesce(max(len), 0)::int best,
        coalesce(max(len) filter (where last_run), 0)::int current
      from (
        select count(*) len, bool_or(rn_all = total) last_run from (
          select won, rn_all, total, rn_all - row_number() over (partition by won order by at) grp
          from (select at, placement = 1 and not forfeit as won,
                  row_number() over (order by at) rn_all, count(*) over () total
                from user_results where user_id = ${u.id} and kind = 'ranked') a
        ) b where won group by grp
      ) c`,
    sql`select coalesce(max(peak), 0)::float8 peak from ratings where user_id = ${u.id}`,
    getRating(u.id, season.id),
  ]);

  const kinds: KindStats[] = KINDS.map((kind) => {
    const r = kindRows.find((x) => x.kind === kind);
    return {
      kind,
      results: r?.results ?? 0,
      completed: r?.completed ?? 0,
      versus: r?.versus ?? 0,
      wins: r?.wins ?? 0,
      avgWpm: round1(r?.avg_wpm ?? 0),
      bestWpm: round1(r?.best_wpm ?? 0),
      avgAcc: round1(r?.avg_acc ?? 0),
      avgConsistency: r?.avg_cons == null ? null : round1(r.avg_cons),
      last10Wpm: r?.last10 == null ? null : round1(r.last10),
      timeMs: Math.round(r?.time_ms ?? 0),
    };
  });

  const pb = (mode: string, len: string): PersonalBest | null => {
    const r = pbRows.find((x) => x.tmode === mode && x.tlen === len);
    if (!r) return null;
    return {
      wpm: round1(r.wpm),
      raw: round1(r.raw),
      acc: round1(r.accuracy),
      consistency: r.consistency == null ? null : round1(r.consistency),
      at: r.at.toISOString(),
      kind: r.kind,
      language: r.language ?? "english",
      punctuation: r.punctuation,
      numbers: r.numbers,
      matchId: r.match_id,
    };
  };

  let rank: number | null = null;
  let ladder = 0;
  const placed = isPlaced(rating.races) && !u.is_bot && !u.flagged_at;
  const [lr] = await sql`
    select count(*)::int ladder, (count(*) filter (where r.rating > ${rating.rating}))::int above
    from ratings r join users x on x.id = r.user_id
    where r.season_id = ${season.id} and r.races >= 5 and x.banned_at is null and x.flagged_at is null and not x.is_bot`;
  ladder = lr?.ladder ?? 0;
  if (placed) rank = (lr?.above ?? 0) + 1;

  return {
    totals: {
      results: kinds.reduce((a, k) => a + k.results, 0),
      completed: kinds.reduce((a, k) => a + k.completed, 0),
      timeMs: kinds.reduce((a, k) => a + k.timeMs, 0),
    },
    kinds,
    pbs: {
      time: Object.fromEntries(PB_TIMES.map((t) => [t, pb("time", t)])),
      words: Object.fromEntries(PB_WORDS.map((w) => [w, pb("words", w)])),
    },
    ranked: {
      allTimePeak: Math.round(Math.max(peakRow[0]?.peak ?? 0, isPlaced(rating.races) ? rating.peak : 0)),
      bestWinStreak: streakRows[0]?.best ?? 0,
      winStreak: streakRows[0]?.current ?? 0,
      rank,
      ladder,
    },
    streak: dayStreaks(dayRows.map((d) => d.d)),
  };
}

export async function wpmHistory(u: StatsUser, kind?: StatKind): Promise<WpmPoint[]> {
  const rows = await sql`
    select * from (
      select at, wpm, raw, accuracy, kind from user_results
      where user_id = ${u.id} and finished ${kind ? sql`and kind = ${kind}` : sql``}
      order by at desc limit ${WPM_HISTORY_POINTS}) t
    order by at`;
  return rows.map((r) => ({ at: r.at.toISOString(), wpm: round1(r.wpm), raw: round1(r.raw), acc: round1(r.accuracy), kind: r.kind }));
}

export async function activity(u: StatsUser, year?: number) {
  const now = new Date();
  const to = year ? new Date(Date.UTC(year, 11, 31)) : new Date(Date.parse(isoDay(now)));
  const from = year ? new Date(Date.UTC(year, 0, 1)) : new Date(to.getTime() - 364 * DAY);
  const rows = await sql<{ d: string; n: number }[]>`
    select to_char(at at time zone 'UTC', 'YYYY-MM-DD') d, count(*)::int n from user_results
    where user_id = ${u.id} and at >= ${from} and at < ${new Date(to.getTime() + DAY)}
    group by 1 order by 1`;
  const days: ActivityDay[] = rows.map((r) => ({ date: r.d, count: r.n }));
  const years: number[] = [];
  for (let y = now.getUTCFullYear(); y >= u.created_at.getUTCFullYear(); y--) years.push(y);
  return { days, from: isoDay(from), to: isoDay(to), years };
}
