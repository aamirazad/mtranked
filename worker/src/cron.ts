// Daily housekeeping (cron trigger in cloudflare.config.ts). Keeps the database small: nothing
// here is ever read again once expired.
import { seasonReset } from "@mtr/shared";
import { all, batch, forgetSeason, one, q } from "./db";

const SEASON_MONTHS = 3;

export async function daily() {
  const now = Date.now();
  await batch([
    q("delete from sessions where expires_at < ?", now),
    q("delete from email_tokens where expires_at < ?", now),
    q("delete from email_codes where expires_at < ?", now),
  ]);
  await rolloverIfEnded(now);
}

/**
 * End the current season once its end date passes and start the next: ratings are pulled
 * toward 1500 and their uncertainty raised (as `pnpm season:rollover` did on the old server).
 */
export async function rolloverIfEnded(now = Date.now()) {
  const cur = await one<{ id: number; ends_at: number; reset_params: string }>(
    "select id, ends_at, reset_params from seasons order by starts_at desc limit 1",
  );
  if (!cur || cur.ends_at > now) return;
  const nextId = cur.id + 1;
  const ends = new Date(now);
  ends.setUTCMonth(ends.getUTCMonth() + SEASON_MONTHS);
  const params = JSON.parse(cur.reset_params) as { pull: number; rd: number };
  const rows = await all<{ user_id: string; rating: number; rd: number; volatility: number }>(
    "select user_id, rating, rd, volatility from ratings where season_id = ?",
    cur.id,
  );
  const carried = rows.map((r) => {
    const n = seasonReset({ rating: r.rating, rd: r.rd, vol: r.volatility }, params);
    return q(
      "insert or ignore into ratings (user_id, season_id, rating, rd, volatility, races, peak, updated_at) values (?, ?, ?, ?, ?, 0, 0, ?)",
      r.user_id,
      nextId,
      n.rating,
      n.rd,
      n.vol,
      now,
    );
  });
  // the season rows first, in one transaction; ratings follow in chunks (D1 caps batch size)
  await batch([
    q("update seasons set ends_at = ? where id = ?", now, cur.id),
    q("insert or ignore into seasons (id, name, starts_at, ends_at) values (?, ?, ?, ?)", nextId, `Season ${nextId}`, now, ends.getTime()),
  ]);
  for (let i = 0; i < carried.length; i += 500) await batch(carried.slice(i, i + 500));
  forgetSeason();
  console.log(`season ${cur.id} closed; season ${nextId} started with ${rows.length} carried ratings`);
}
