// Profile statistics, derived from finished ranked races in the user_results view. Casual,
// private room and practice results only show up in the match history, not in these stats.
import type { ActivityDay, ProfileStats, WpmPoint } from "@mtr/contracts";
import { all, currentSeason, getRating, iso, isPlaced, one } from "../db";

const RANKED = "kind = 'ranked'";
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
  const [r, bestRow, dayRows, streakRow, peakRow, rating] = await Promise.all([
    one(
      `select count(*) races, count(*) filter (where finished) completed,
        count(*) filter (where placement = 1 and not forfeit) wins,
        coalesce(avg(wpm) filter (where finished), 0) avg_wpm,
        coalesce(max(wpm) filter (where finished), 0) best_wpm,
        coalesce(avg(accuracy) filter (where finished), 0) avg_acc,
        avg(consistency) filter (where finished) avg_cons,
        avg(wpm) filter (where finished and rn <= 10) last10,
        coalesce(sum(duration_ms), 0) time_ms
      from (select *, row_number() over (partition by finished order by at desc) rn
            from user_results where user_id = ? and ${RANKED}) t`,
      u.id,
    ),
    one<{ match_id: string }>(
      `select match_id from user_results where user_id = ? and ${RANKED} and finished order by wpm desc, at limit 1`,
      u.id,
    ),
    all<{ d: string }>(
      `select distinct strftime('%Y-%m-%d', at / 1000, 'unixepoch') d from user_results
      where user_id = ? and ${RANKED} order by d desc`,
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
                from user_results where user_id = ? and ${RANKED}) a
        ) b where won group by grp
      ) c`,
      u.id,
    ),
    one("select coalesce(max(peak), 0) peak from ratings where user_id = ?", u.id),
    getRating(u.id, season.id),
  ]);

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
    races: {
      races: n(r?.races),
      completed: n(r?.completed),
      wins: n(r?.wins),
      avgWpm: round1(n(r?.avg_wpm)),
      bestWpm: round1(n(r?.best_wpm)),
      bestMatchId: bestRow?.match_id ?? null,
      avgAcc: round1(n(r?.avg_acc)),
      avgConsistency: r?.avg_cons == null ? null : round1(n(r.avg_cons)),
      last10Wpm: r?.last10 == null ? null : round1(n(r.last10)),
      timeMs: Math.round(n(r?.time_ms)),
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

export async function wpmHistory(u: StatsUser): Promise<WpmPoint[]> {
  const rows = await all(
    `select * from (
      select at, wpm, raw, accuracy from user_results
      where user_id = ? and ${RANKED} and finished
      order by at desc limit ${WPM_HISTORY_POINTS}) t
    order by at`,
    u.id,
  );
  return rows.map((r) => ({
    at: iso(r.at),
    wpm: round1(n(r.wpm)),
    raw: round1(n(r.raw)),
    acc: round1(n(r.accuracy)),
  }));
}

export async function activity(u: StatsUser, year?: number) {
  const now = new Date();
  const to = year ? new Date(Date.UTC(year, 11, 31)) : new Date(Date.parse(isoDay(now)));
  const from = year ? new Date(Date.UTC(year, 0, 1)) : new Date(to.getTime() - 364 * DAY);
  const rows = await all<{ d: string; n: number }>(
    `select strftime('%Y-%m-%d', at / 1000, 'unixepoch') d, count(*) n from user_results
    where user_id = ? and ${RANKED} and at >= ? and at < ? group by 1 order by 1`,
    u.id,
    from.getTime(),
    to.getTime() + DAY,
  );
  const days: ActivityDay[] = rows.map((r) => ({ date: r.d, count: r.n }));
  const years: number[] = [];
  for (let y = now.getUTCFullYear(); y >= new Date(u.created_at).getUTCFullYear(); y--) years.push(y);
  return { days, from: isoDay(from), to: isoDay(to), years };
}
