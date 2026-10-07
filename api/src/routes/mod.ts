import { initServer } from "@ts-rest/express";
import type { Request, Response } from "express";
import { contract } from "@mtr/contracts";
import { sql, currentSeason, getRating } from "@mtr/db";
import { getAuth } from "../auth";

const s = initServer();
const forbidden = { status: 403 as const, body: { message: "Moderators only." } };

async function mod(req: Request, res: Response) {
  const auth = await getAuth(req, res);
  return auth?.user.is_moderator ? auth.user : null;
}

/** Ban a user and give back rating their recent ranked opponents lost to them. */
async function banUser(userId: string) {
  const season = await currentSeason();
  await sql.begin(async (tx) => {
    await tx`update users set banned_at = now() where id = ${userId}`;
    await tx`delete from sessions where user_id = ${userId}`;
    const losses = await tx`
      select o.user_id, o.rating_delta, m.id from matches m
      join match_players me on me.match_id = m.id and me.user_id = ${userId}
      join match_players o on o.match_id = m.id and o.user_id <> ${userId}
      where m.mode = 'ranked' and m.status = 'finished' and m.season_id = ${season.id}
        and m.finished_at > now() - interval '30 days' and o.rating_delta < 0`;
    for (const l of losses) {
      await tx`update ratings set rating = rating - ${l.rating_delta}
        where user_id = ${l.user_id} and season_id = ${season.id}`;
      await tx`update match_players set rating_delta = 0 where match_id = ${l.id} and user_id = ${l.user_id}`;
    }
    await tx`update matches set status = 'void' where id in (
      select match_id from match_players where user_id = ${userId}) and mode = 'ranked'`;
  });
}

export const modRouter = s.router(contract.mod, {
  reports: async ({ req, res }) => {
    if (!(await mod(req, res))) return forbidden;
    const rows = await sql`
      select r.*, a.display_name reporter, b.display_name reported from reports r
      left join users a on a.id = r.reporter_id left join users b on b.id = r.reported_user_id
      where r.status = 'open' order by r.created_at limit 200`;
    return {
      status: 200,
      body: {
        reports: rows.map((r) => ({
          id: Number(r.id),
          matchId: r.match_id,
          reason: r.reason,
          status: r.status,
          createdAt: r.created_at.toISOString(),
          reporter: r.reporter,
          reported: r.reported,
          reportedId: r.reported_user_id,
          notes: r.moderator_notes,
        })),
      },
    };
  },

  resolveReport: async ({ req, res, params, body }) => {
    const m = await mod(req, res);
    if (!m) return forbidden;
    const [r] = await sql`select * from reports where id = ${params.id}`;
    if (!r) return { status: 404, body: { message: "No such report." } };
    if (body.action === "ban" && r.reported_user_id) await banUser(r.reported_user_id);
    if (body.action === "flag" && r.reported_user_id) {
      await sql`update users set flagged_at = coalesce(flagged_at, now()) where id = ${r.reported_user_id}`;
    }
    await sql`update reports set status = ${body.action === "dismiss" ? "dismissed" : "actioned"},
      moderator_notes = ${body.notes ?? null}, resolved_at = now(), resolved_by = ${m.id}
      where id = ${params.id}`;
    return { status: 200, body: { ok: true } };
  },

  held: async ({ req, res }) => {
    if (!(await mod(req, res))) return forbidden;
    const rows = await sql`
      select m.id, m.finished_at, json_agg(json_build_object('name', coalesce(u.display_name, mp.guest_name), 'wpm', mp.wpm, 'acc', mp.accuracy) order by mp.placement) players
      from matches m join match_players mp on mp.match_id = m.id left join users u on u.id = mp.user_id
      where m.status = 'held' group by m.id order by m.finished_at`;
    return {
      status: 200,
      body: { matches: rows.map((r) => ({ matchId: r.id, finishedAt: r.finished_at.toISOString(), players: r.players })) },
    };
  },

  resolveHeld: async ({ req, res, params, body }) => {
    if (!(await mod(req, res))) return forbidden;
    const [m] = await sql`select * from matches where id = ${params.id} and status = 'held'`;
    if (!m) return { status: 404, body: { message: "No such held match." } };
    if (body.action === "void") {
      await sql`update matches set status = 'void' where id = ${m.id}`;
      return { status: 200, body: { ok: true } };
    }
    // approve: apply the pending rating changes computed when the race ended
    const pending = (m.rating_deltas ?? {}) as Record<string, { delta: number; rd: number; vol: number; won: boolean }>;
    await sql.begin(async (tx) => {
      for (const [userId, p] of Object.entries(pending)) {
        const r = await getRating(userId, m.season_id, tx);
        const rating = r.rating + p.delta;
        await tx`insert into ratings (user_id, season_id, rating, rd, volatility, races, wins, peak)
          values (${userId}, ${m.season_id}, ${rating}, ${p.rd}, ${p.vol}, 1, ${p.won ? 1 : 0}, ${rating})
          on conflict (user_id, season_id) do update set rating = ${rating}, rd = ${p.rd}, volatility = ${p.vol},
            races = ratings.races + 1, wins = ratings.wins + ${p.won ? 1 : 0},
            peak = greatest(ratings.peak, ${rating}), updated_at = now()`;
      }
      await tx`update matches set status = 'finished' where id = ${m.id}`;
    });
    return { status: 200, body: { ok: true } };
  },

  flags: async ({ req, res }) => {
    if (!(await mod(req, res))) return forbidden;
    const rows = await sql`select f.*, u.display_name from flags f join users u on u.id = f.user_id
      order by f.created_at desc limit 200`;
    return {
      status: 200,
      body: {
        flags: rows.map((f) => ({
          id: Number(f.id),
          user: f.display_name,
          userId: f.user_id,
          matchId: f.match_id,
          reason: f.reason,
          details: f.details,
          createdAt: f.created_at.toISOString(),
        })),
      },
    };
  },

  unflag: async ({ req, res, params }) => {
    if (!(await mod(req, res))) return forbidden;
    await sql`update users set flagged_at = null where id = ${params.id}`;
    return { status: 200, body: { ok: true } };
  },
});
