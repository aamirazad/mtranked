import { sql, grantTierCosmetics, intArray, type Sql } from "@mtr/db";
import type { RaceResultRow, TextSettings } from "@mtr/race-protocol";
import type { Keystroke } from "@mtr/engine";
import { PLACEMENT_RACES } from "@mtr/shared";
import type { Flag } from "./anticheat";

export type RatingUpdate = { rating: number; rd: number; vol: number; won: boolean; delta: number };

export type SaveInput = {
  matchId: string;
  mode: string;
  seed: string;
  settings: TextSettings;
  text: string;
  seasonId: number | null;
  startedAt: Date;
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

async function applyRating(tx: Sql, userId: string, seasonId: number, u: RatingUpdate) {
  const [r] = await tx`
    insert into ratings (user_id, season_id, rating, rd, volatility, races, wins, peak)
    values (${userId}, ${seasonId}, ${u.rating}, ${u.rd}, ${u.vol}, 1, ${u.won ? 1 : 0}, 0)
    on conflict (user_id, season_id) do update set rating = ${u.rating}, rd = ${u.rd}, volatility = ${u.vol},
      races = ratings.races + 1, wins = ratings.wins + ${u.won ? 1 : 0}, updated_at = now()
    returning races`;
  // season peak (and tier rewards) only count once placements are done
  if (r && r.races >= PLACEMENT_RACES) {
    await tx`update ratings set peak = greatest(peak, ${u.rating}) where user_id = ${userId} and season_id = ${seasonId}`;
    await grantTierCosmetics(tx, userId, u.rating);
  }
}

/** Large performance jumps compared with the player's recent ranked history. */
async function performanceJump(userId: string, wpm: number): Promise<Flag | null> {
  const [h] = await sql`select avg(wpm) avg, count(*)::int n from (
      select mp.wpm from match_players mp join matches m on m.id = mp.match_id
      where mp.user_id = ${userId} and m.mode = 'ranked' and mp.finished order by m.finished_at desc limit 10) t`;
  if (!h || h.n < 8) return null;
  if (wpm > h.avg * 1.35 + 15) return { reason: "performance_jump", details: { wpm, recentAvg: Math.round(h.avg) }, shadow: false };
  return null;
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

  await sql.begin(async (tx) => {
    await tx`insert into matches (id, mode, seed, text_settings, text, season_id, status, ghost_of, started_at, finished_at, rating_deltas, players)
      values (${input.matchId}, ${input.mode}, ${input.seed}, ${tx.json(input.settings)}, ${input.text}, ${input.seasonId},
        ${input.held ? "held" : "finished"}, ${input.ghostOf ?? null}, ${input.startedAt}, now(),
        ${input.ratings.size ? tx.json(pending) : null}, ${input.rows.length})`;
    let slot = 0;
    for (const row of input.rows) {
      const r = row.result;
      await tx`insert into match_players (match_id, slot, user_id, guest_name, placement, wpm, raw, accuracy,
          finished_at_ms, finished, forfeit, rating_before, rating_after, rating_delta, xp, duration_ms, consistency, chars)
        values (${input.matchId}, ${slot}, ${row.userId ?? null}, ${row.guestName ?? null}, ${r.placement}, ${r.wpm}, ${r.raw},
          ${r.acc}, ${r.timeMs}, ${r.finished}, ${r.forfeit}, ${r.ratingBefore ?? null}, ${r.ratingAfter ?? null},
          ${r.delta ?? null}, ${r.xp ?? 0}, ${row.durationMs ?? r.timeMs}, ${r.consistency ?? null}, ${r.chars ? intArray(tx, r.chars) : null})`;
      if (row.keys) await tx`insert into replays (match_id, slot, keystrokes) values (${input.matchId}, ${slot}, ${tx.json(row.keys)})`;
      if (row.userId) {
        if (r.xp) await tx`update users set xp = xp + ${r.xp} where id = ${row.userId}`;
        for (const f of row.flags) {
          await tx`insert into flags (user_id, match_id, reason, details) values (${row.userId}, ${input.matchId}, ${f.reason}, ${tx.json(f.details)})`;
          if (f.shadow) await tx`update users set flagged_at = coalesce(flagged_at, now()) where id = ${row.userId}`;
        }
        const upd = input.ratings.get(row.userId);
        if (upd && !input.held && input.seasonId !== null) await applyRating(tx, row.userId, input.seasonId, upd);
      }
      slot++;
    }
  });
}
