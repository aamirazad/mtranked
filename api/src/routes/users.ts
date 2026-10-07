import { initServer } from "@ts-rest/express";
import { contract, type MatchSummary } from "@mtr/contracts";
import { sql, currentSeason, getRating, getUser, unlockedCosmetics } from "@mtr/db";
import { COSMETICS, DEFAULT_EQUIPPED, FREE_HISTORY_LIMIT, levelFromXp, resolveEquipped, type Equipped } from "@mtr/shared";
import { buildMe, getAuth } from "../auth";
import { rateLimit } from "../redis";

const s = initServer();
const PAGE = 20;
const unauth = { status: 401 as const, body: { message: "Sign in first." } };

export const meRouter = s.router(contract.me, {
  update: async ({ body, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const u = auth.user;
    if (body.displayName && body.displayName.toLowerCase() !== u.display_name.toLowerCase()) {
      const [taken] = await sql`select 1 from users where display_name = ${body.displayName}`;
      if (taken) return { status: 409, body: { message: "That name is taken.", fields: { displayName: "Taken" } } };
    }
    let equipped = { ...DEFAULT_EQUIPPED, ...(u.equipped as Partial<Equipped>) };
    if (body.equipped) {
      const unlocked = await unlockedCosmetics(u);
      for (const [slot, id] of Object.entries(body.equipped)) {
        const c = COSMETICS.find((x) => x.id === id);
        if (!c || c.type !== slot || !unlocked.has(id!)) {
          return { status: 400, body: { message: "That cosmetic isn't unlocked yet." } };
        }
      }
      equipped = { ...equipped, ...body.equipped };
    }
    await sql`update users set
      display_name = ${body.displayName ?? u.display_name},
      country = ${body.country === undefined ? u.country : body.country},
      equipped = ${sql.json(equipped)}
      where id = ${u.id}`;
    return { status: 200, body: { user: await buildMe((await getUser(u.id))!) } };
  },

  cosmetics: async ({ req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const unlocked = await unlockedCosmetics(auth.user);
    return {
      status: 200,
      body: { unlocked: [...unlocked], equipped: { ...DEFAULT_EQUIPPED, ...(auth.user.equipped as Partial<Equipped>) } },
    };
  },
});

async function userByName(name: string) {
  const [u] = await sql`select id, display_name, country, created_at, is_subscriber, xp, equipped, is_bot
    from users where display_name = ${name} and banned_at is null`;
  return u;
}

export const usersRouter = s.router(contract.users, {
  profile: async ({ params }) => {
    const u = await userByName(params.name);
    if (!u) return { status: 404, body: { message: "No such player." } };
    const season = await currentSeason();
    const r = await getRating(u.id, season.id);
    const seasons = await sql`select r.season_id, s.name, r.peak, r.races from ratings r
      join seasons s on s.id = r.season_id where r.user_id = ${u.id} order by r.season_id desc`;
    const [st] = await sql`select coalesce(avg(wpm),0) avg_wpm, coalesce(max(wpm),0) best_wpm,
      coalesce(avg(accuracy),0) avg_acc, count(*)::int total
      from (select wpm, accuracy from match_players mp join matches m on m.id = mp.match_id
            where mp.user_id = ${u.id} and mp.finished and m.status <> 'void'
            order by m.finished_at desc limit 50) t`;
    const eq = resolveEquipped(u.equipped);
    return {
      status: 200,
      body: {
        profile: {
          id: u.id,
          name: u.display_name,
          country: u.country,
          createdAt: u.created_at.toISOString(),
          subscriber: u.is_subscriber,
          level: levelFromXp(u.xp).level,
          xp: u.xp,
          rating: Math.round(r.rating),
          races: r.races,
          wins: r.wins,
          losses: r.races - r.wins,
          peak: Math.round(r.peak),
          banner: eq.banner,
          caretColor: eq.caretColor,
          seasons: seasons.map((x) => ({
            seasonId: x.season_id,
            name: x.name,
            peak: Math.round(x.peak),
            races: x.races,
            current: x.season_id === season.id,
          })),
          stats: {
            avgWpm: Math.round(st!.avg_wpm),
            bestWpm: Math.round(st!.best_wpm),
            avgAcc: Math.round(st!.avg_acc * 10) / 10,
            total: st!.total,
          },
        },
      },
    };
  },

  matches: async ({ params, query }) => {
    const u = await userByName(params.name);
    if (!u) return { status: 404, body: { message: "No such player." } };
    const cap = u.is_subscriber ? Infinity : FREE_HISTORY_LIMIT;
    const limit = Math.max(0, Math.min(PAGE, cap - query.offset));
    const rows = limit
      ? await sql`
        select m.id, m.mode, m.status, m.finished_at, mp.placement, mp.wpm, mp.accuracy, mp.rating_delta, mp.finished,
          (select count(*)::int from match_players x where x.match_id = m.id) players,
          (select coalesce(ou.display_name, x.guest_name) from match_players x left join users ou on ou.id = x.user_id
             where x.match_id = m.id and x.slot <> mp.slot order by x.slot limit 1) opponent
        from match_players mp join matches m on m.id = mp.match_id
        where mp.user_id = ${u.id} and m.mode <> 'seed'
        order by m.finished_at desc offset ${query.offset} limit ${limit + 1}`
      : [];
    const matches: MatchSummary[] = rows.slice(0, limit).map((r) => ({
      matchId: r.id,
      mode: r.mode,
      status: r.status,
      finishedAt: r.finished_at.toISOString(),
      placement: r.placement,
      players: r.players,
      wpm: r.wpm,
      acc: r.accuracy,
      delta: r.rating_delta,
      finished: r.finished,
      opponent: r.players === 2 ? r.opponent : null,
    }));
    const more = rows.length > limit && query.offset + limit < cap;
    return { status: 200, body: { matches, more, limited: !u.is_subscriber && query.offset + limit >= cap } };
  },
});

export const leaderboardRoute = s.route(contract.leaderboard, async ({ query }) => {
  const season = await currentSeason();
  const rows = await sql`
    select r.user_id, u.display_name, u.country, u.is_subscriber, r.rating, r.races, r.wins
    from ratings r join users u on u.id = r.user_id
    where r.season_id = ${season.id} and r.races >= 5 and u.banned_at is null and u.flagged_at is null and not u.is_bot
      ${query.country ? sql`and u.country = ${query.country.toUpperCase()}` : sql``}
    order by r.rating desc limit 100`;
  return {
    status: 200,
    body: {
      season: { id: season.id, name: season.name, endsAt: season.ends_at.toISOString() },
      rows: rows.map((r, i) => ({
        rank: i + 1,
        id: r.user_id,
        name: r.display_name,
        country: r.country,
        rating: Math.round(r.rating),
        races: r.races,
        wins: r.wins,
        subscriber: r.is_subscriber,
      })),
    },
  };
});

export const seasonRoute = s.route(contract.season, async () => {
  const season = await currentSeason();
  return {
    status: 200,
    body: { id: season.id, name: season.name, startsAt: season.starts_at.toISOString(), endsAt: season.ends_at.toISOString() },
  };
});

export const matchRoute = s.route(contract.match, async ({ params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return { status: 404, body: { message: "Match not found." } };
  const [m] = await sql`select * from matches where id = ${params.id}`;
  if (!m) return { status: 404, body: { message: "Match not found." } };
  const players = await sql`
    select mp.*, u.display_name, u.equipped, r.keystrokes
    from match_players mp left join users u on u.id = mp.user_id
    left join replays r on r.match_id = mp.match_id and r.slot = mp.slot
    where mp.match_id = ${m.id} order by mp.placement`;
  return {
    status: 200,
    body: {
      match: {
        id: m.id,
        mode: m.mode,
        status: m.status,
        text: m.text,
        seed: m.seed,
        startedAt: m.started_at.toISOString(),
        finishedAt: m.finished_at.toISOString(),
        players: players.map((p) => ({
          slot: p.slot,
          userId: p.user_id,
          name: p.display_name ?? p.guest_name ?? "deleted",
          placement: p.placement,
          wpm: p.wpm,
          raw: p.raw,
          acc: p.accuracy,
          timeMs: p.finished_at_ms,
          finished: p.finished,
          forfeit: p.forfeit,
          delta: p.rating_delta,
          caretColor: resolveEquipped(p.equipped).caretColor,
          keystrokes: p.keystrokes,
        })),
      },
    },
  };
});

export const reportRoute = s.route(contract.report, async ({ body, req, res }) => {
  const auth = await getAuth(req, res);
  if (!auth) return unauth;
  if (!(await rateLimit(`report:${auth.user.id}`, 10, 3600))) {
    return { status: 429, body: { message: "You've sent a lot of reports. Try again later." } };
  }
  const [m] = await sql`select 1 from matches where id = ${body.matchId}`;
  if (!m) return { status: 400, body: { message: "Unknown match." } };
  await sql`insert into reports (reporter_id, match_id, reported_user_id, reason)
    values (${auth.user.id}, ${body.matchId}, ${body.reportedUserId ?? null}, ${body.reason})`;
  return { status: 200, body: { ok: true } };
});
