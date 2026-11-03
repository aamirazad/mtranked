import type { RaceResultRow, TextSettings } from "@mtr/race-protocol";
import type { Keystroke } from "@mtr/engine";
import { PLACEMENT_RACES } from "@mtr/shared";
import { batch, one, q, tierCosmeticIds } from "../db";
import { packKeys } from "../keys";
import type { Flag } from "./anticheat";

export type RatingUpdate = { rating: number; rd: number; vol: number; won: boolean; delta: number };

export type SaveInput = {
  matchId: string;
  mode: string;
  seed: string;
  settings: TextSettings;
  text: string;
  seasonId: number | null;
  startedAt: number;
  ghostOf?: string;
  held: boolean;
  rows: {
    userId?: string;
    guestName?: string;
    result: RaceResultRow;
    /** how long this player typed for (to the finish, forfeit or end of the race) */
    durationMs?: number;
    keys: Keystroke[] | null;
    flags: Flag[];
  }[];
  ratings: Map<string, RatingUpdate>;
};

/** Large performance jumps compared with the player's recent ranked history. */
async function performanceJump(userId: string, wpm: number): Promise<Flag | null> {
  const h = await one<{ avg: number | null; n: number }>(
    `select avg(wpm) avg, count(*) n from (
      select mp.wpm from match_players mp join matches m on m.id = mp.match_id
      where mp.user_id = ? and m.mode = 'ranked' and mp.finished order by m.finished_at desc limit 10) t`,
    userId,
  );
  if (!h || h.n < 8 || h.avg == null) return null;
  if (wpm > h.avg * 1.35 + 15) return { reason: "performance_jump", details: { wpm, recentAvg: Math.round(h.avg) }, shadow: false };
  return null;
}

/** Rating upsert; season peak (and tier rewards) only count once placements are done. */
function applyRating(userId: string, seasonId: number, u: RatingUpdate, now: number): D1PreparedStatement[] {
  return [
    q(
      `insert into ratings (user_id, season_id, rating, rd, volatility, races, wins, peak, updated_at)
      values (?1, ?2, ?3, ?4, ?5, 1, ?6, 0, ?7)
      on conflict (user_id, season_id) do update set rating = ?3, rd = ?4, volatility = ?5,
        races = races + 1, wins = wins + ?6, updated_at = ?7,
        peak = case when races + 1 >= ${PLACEMENT_RACES} then max(peak, ?3) else peak end`,
      userId,
      seasonId,
      u.rating,
      u.rd,
      u.vol,
      u.won ? 1 : 0,
      now,
    ),
    ...tierCosmeticIds(u.rating).map((id) =>
      q(
        `insert or ignore into user_cosmetics (user_id, cosmetic_id)
        select ?1, ?2 where (select races from ratings where user_id = ?1 and season_id = ?3) >= ${PLACEMENT_RACES}`,
        userId,
        id,
        seasonId,
      ),
    ),
  ];
}

export async function saveRace(input: SaveInput) {
  for (const row of input.rows) {
    if (row.userId && (input.mode === "ranked" || input.mode === "casual") && row.result.finished) {
      const jump = await performanceJump(row.userId, row.result.wpm);
      if (jump) row.flags.push(jump);
    }
  }
  const pending: Record<string, RatingUpdate> = {};
  for (const [id, u] of input.ratings) pending[id] = u;
  const now = Date.now();

  const stmts: D1PreparedStatement[] = [
    q(
      `insert into matches (id, mode, seed, text_settings, text, season_id, status, ghost_of, started_at, finished_at, rating_deltas, players)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.matchId,
      input.mode,
      input.seed,
      JSON.stringify(input.settings),
      input.text,
      input.seasonId,
      input.held ? "held" : "finished",
      input.ghostOf ?? null,
      input.startedAt,
      now,
      input.ratings.size && input.held ? JSON.stringify(pending) : null,
      input.rows.length,
    ),
  ];
  input.rows.forEach((row, slot) => {
    const r = row.result;
    stmts.push(
      q(
        `insert into match_players (match_id, slot, user_id, guest_name, placement, wpm, raw, accuracy, finished_at_ms, finished,
          forfeit, rating_before, rating_after, rating_delta, xp, duration_ms, consistency, chars)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.matchId,
        slot,
        row.userId ?? null,
        row.guestName ?? null,
        r.placement,
        r.wpm,
        r.raw,
        r.acc,
        r.timeMs,
        r.finished ? 1 : 0,
        r.forfeit ? 1 : 0,
        r.ratingBefore ?? null,
        r.ratingAfter ?? null,
        r.delta ?? null,
        r.xp ?? 0,
        row.durationMs ?? r.timeMs,
        r.consistency ?? null,
        r.chars ? JSON.stringify(r.chars) : null,
      ),
    );
    if (row.keys?.length) {
      stmts.push(q("insert into replays (match_id, slot, keystrokes) values (?, ?, ?)", input.matchId, slot, packKeys(row.keys)));
    }
    if (!row.userId) return;
    if (r.xp) stmts.push(q("update users set xp = xp + ? where id = ?", r.xp, row.userId));
    for (const f of row.flags) {
      stmts.push(
        q(
          "insert into flags (user_id, match_id, reason, details, created_at) values (?, ?, ?, ?, ?)",
          row.userId,
          input.matchId,
          f.reason,
          JSON.stringify(f.details),
          now,
        ),
      );
      if (f.shadow) stmts.push(q("update users set flagged_at = coalesce(flagged_at, ?) where id = ?", now, row.userId));
    }
    const upd = input.ratings.get(row.userId);
    if (upd && !input.held && input.seasonId !== null) stmts.push(...applyRating(row.userId, input.seasonId, upd, now));
  });
  // one transaction: the match is saved whole or not at all
  await batch(stmts);
}
