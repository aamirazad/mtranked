// Profile statistics, all derived from server-scored results (the user_results view:
// finished races plus server-replayed practice tests).
import type { ActivityDay, KindStats, PersonalBest, ProfileStats, StatKind, WpmPoint } from "@mtr/contracts";
import { all, bool, currentSeason, getRating, iso, isPlaced, one } from "../db";

const PB_TIMES = [15, 30, 60, 120];
const PB_WORDS = [10, 25, 50, 100];
const KINDS: StatKind[] = ["ranked", "casual", "private", "practice"];
const WPM_HISTORY_POINTS = 300;
const DAY = 86_400_000;

export type StatsUser = { id: string; created_at: number; is_bot: boolean; flagged_at?: number | null };

const round1 = (n: number) => Math.round(n * 10) / 10;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);

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
  const [kindRows, pbRows, dayRows, streakRow, peakRow, rating] = await Promise.all([
    all(
      `select kind, count(*) results, count(*) filter (where finished) completed,
        count(*) filter (where players > 1) versus,
        count(*) filter (where players > 1 and placement = 1 and not forfeit) wins,
        coalesce(avg(wpm) filter (where finished), 0) avg_wpm,
        coalesce(max(wpm) filter (where finished), 0) best_wpm,
        coalesce(avg(accuracy) filter (where finished), 0) avg_acc,
        avg(consistency) filter (where finished) avg_cons,
        avg(wpm) filter (where finished and rn <= 10) last10,
        coalesce(sum(duration_ms), 0) time_ms
      from (select *, row_number() over (partition by kind, finished order by at desc) rn
            from user_results where user_id = ?) t
      group by kind`,
      u.id,
    ),
    // best result per test (time 15/30/60/120, words 10/25/50/100), plain tests only
    all(
      `select * from (
        select tmode, tlen, wpm, raw, accuracy, consistency, at, kind, match_id,
          settings ->> '$.language' language,
          coalesce(settings ->> '$.punctuation', 0) punctuation,
          coalesce(settings ->> '$.numbers', 0) numbers,
          row_number() over (partition by tmode, tlen order by wpm desc, at) pick
        from (select *, settings ->> '$.mode' tmode,
                case settings ->> '$.mode' when 'time' then settings ->> '$.time' else settings ->> '$.words' end tlen
              from user_results
              where user_id = ? and finished and settings ->> '$.mode' in ('time', 'words')
                and settings ->> '$.funbox' is null and settings ->> '$.rules' is null) t
        where (tmode = 'time' and tlen in (${PB_TIMES.join(",")})) or (tmode = 'words' and tlen in (${PB_WORDS.join(",")}))
      ) where pick = 1`,
      u.id,
    ),
    all<{ d: string }>(
      `select distinct strftime('%Y-%m-%d', at / 1000, 'unixepoch') d from user_results where user_id = ? order by d desc`,
      u.id,
    ),
    // ranked win streaks: runs of wins (gaps and islands over the ranked results in order)
    one(
      `select coalesce(max(len), 0) best, coalesce(max(len) filter (where last_run), 0) current
      from (
        select count(*) len, max(rn_all = total) last_run from (
          select won, rn_all, total, rn_all - row_number() over (partition by won order by at) grp
          from (select at, placement = 1 and not forfeit as won,
                  row_number() over (order by at) rn_all, count(*) over () total
                from user_results where user_id = ? and kind = 'ranked') a
        ) b where won group by grp
      ) c`,
      u.id,
    ),
    one("select coalesce(max(peak), 0) peak from ratings where user_id = ?", u.id),
    getRating(u.id, season.id),
  ]);

  const kinds: KindStats[] = KINDS.map((kind) => {
    const r = kindRows.find((x) => x.kind === kind);
    return {
      kind,
      results: n(r?.results),
      completed: n(r?.completed),
      versus: n(r?.versus),
      wins: n(r?.wins),
      avgWpm: round1(n(r?.avg_wpm)),
      bestWpm: round1(n(r?.best_wpm)),
      avgAcc: round1(n(r?.avg_acc)),
      avgConsistency: r?.avg_cons == null ? null : round1(n(r.avg_cons)),
      last10Wpm: r?.last10 == null ? null : round1(n(r.last10)),
      timeMs: Math.round(n(r?.time_ms)),
    };
  });

  const pb = (mode: string, len: number): PersonalBest | null => {
    const r = pbRows.find((x) => x.tmode === mode && n(x.tlen) === len);
    if (!r) return null;
    return {
      wpm: round1(n(r.wpm)),
      raw: round1(n(r.raw)),
      acc: round1(n(r.accuracy)),
      consistency: r.consistency == null ? null : round1(n(r.consistency)),
      at: iso(r.at),
      kind: r.kind as StatKind,
      language: (r.language as string | null) ?? "english",
      punctuation: bool(r.punctuation),
      numbers: bool(r.numbers),
      matchId: (r.match_id as string | null) ?? null,
    };
  };

  let rank: number | null = null;
  const placed = isPlaced(rating.races) && !u.is_bot && !u.flagged_at;
  const lr = await one(
    `select count(*) ladder, count(*) filter (where r.rating > ?) above
    from ratings r join users x on x.id = r.user_id
    where r.season_id = ? and r.races >= 5 and x.banned_at is null and x.flagged_at is null and not x.is_bot`,
    rating.rating,
    season.id,
  );
  const ladder = n(lr?.ladder);
  if (placed) rank = n(lr?.above) + 1;

  return {
    totals: {
      results: kinds.reduce((a, k) => a + k.results, 0),
      completed: kinds.reduce((a, k) => a + k.completed, 0),
      timeMs: kinds.reduce((a, k) => a + k.timeMs, 0),
    },
    kinds,
    pbs: {
      time: Object.fromEntries(PB_TIMES.map((t) => [String(t), pb("time", t)])),
      words: Object.fromEntries(PB_WORDS.map((w) => [String(w), pb("words", w)])),
    },
    ranked: {
      allTimePeak: Math.round(Math.max(n(peakRow?.peak), isPlaced(rating.races) ? rating.peak : 0)),
      bestWinStreak: n(streakRow?.best),
      winStreak: n(streakRow?.current),
      rank,
      ladder,
    },
    streak: dayStreaks(dayRows.map((d) => d.d)),
  };
}

export async function wpmHistory(u: StatsUser, kind?: StatKind): Promise<WpmPoint[]> {
  const rows = await all(
    `select * from (
      select at, wpm, raw, accuracy, kind from user_results
      where user_id = ?1 and finished and (?2 is null or kind = ?2)
      order by at desc limit ${WPM_HISTORY_POINTS}) t
    order by at`,
    u.id,
    kind ?? null,
  );
  return rows.map((r) => ({
    at: iso(r.at),
    wpm: round1(n(r.wpm)),
    raw: round1(n(r.raw)),
    acc: round1(n(r.accuracy)),
    kind: r.kind as StatKind,
  }));
}

export async function activity(u: StatsUser, year?: number) {
  const now = new Date();
  const to = year ? new Date(Date.UTC(year, 11, 31)) : new Date(Date.parse(isoDay(now)));
  const from = year ? new Date(Date.UTC(year, 0, 1)) : new Date(to.getTime() - 364 * DAY);
  const rows = await all<{ d: string; n: number }>(
    `select strftime('%Y-%m-%d', at / 1000, 'unixepoch') d, count(*) n from user_results
    where user_id = ? and at >= ? and at < ? group by 1 order by 1`,
    u.id,
    from.getTime(),
    to.getTime() + DAY,
  );
  const days: ActivityDay[] = rows.map((r) => ({ date: r.d, count: r.n }));
  const years: number[] = [];
  for (let y = now.getUTCFullYear(); y >= new Date(u.created_at).getUTCFullYear(); y--) years.push(y);
  return { days, from: isoDay(from), to: isoDay(to), years };
}
