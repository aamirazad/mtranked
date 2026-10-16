import { initServer } from "@ts-rest/express";
import { contract, type MatchSummary, type SyncedPrefs } from "@mtr/contracts";
import { sql, currentSeason, getRating, getUser, unlockedCosmetics } from "@mtr/db";
import { COSMETICS, DEFAULT_EQUIPPED, DEFAULT_RATING, FREE_HISTORY_LIMIT, OFFENSIVE_NAME_MESSAGE, isOffensiveName, levelFromXp, resolveEquipped, type Equipped } from "@mtr/shared";
import { buildMe, getAuth, nextNameChange } from "../auth";
import { rateLimit } from "../redis";

const s = initServer();
const PAGE = 20;
const HISTORY_POINTS = 1000;
const KIND_MODES = { ranked: ["ranked"], casual: ["casual", "ghost"], private: ["private"] };
const unauth = { status: 401 as const, body: { message: "Sign in first." } };

export const meRouter = s.router(contract.me, {
  update: async ({ body, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const u = auth.user;
    const name = body.displayName;
    const renaming = !!name && name !== u.display_name;
    if (renaming) {
      if (isOffensiveName(name)) {
        return { status: 400, body: { message: OFFENSIVE_NAME_MESSAGE, fields: { displayName: OFFENSIVE_NAME_MESSAGE } } };
      }
      const next = nextNameChange(u);
      if (next) {
        const msg = `You can change your name again on ${next.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`;
        return { status: 400, body: { message: msg, fields: { displayName: msg } } };
      }
    }
    if (name && renaming && name.toLowerCase() !== u.display_name.toLowerCase()) {
      const [taken] = await sql`select 1 from users where display_name = ${name}`;
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
      equipped = ${sql.json(equipped)},
      name_changed_at = ${renaming ? sql`now()` : sql`name_changed_at`}
      where id = ${u.id}`;
    return { status: 200, body: { user: await buildMe((await getUser(u.id))!) } };
  },

  prefs: async ({ body, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    // a client clock running ahead mustn't make its changes win forever
    const now = Date.now();
    const prefs = await sql.begin(async (tx) => {
      const [row] = await tx`select prefs from users where id = ${auth.user.id} for update`;
      const merged = { ...(row!.prefs as Record<string, { v: string | number | boolean; t: number }>) };
      for (const [k, e] of Object.entries(body)) {
        if (!e) continue;
        const t = Math.min(e.t, now);
        if (!merged[k] || merged[k].t < t) merged[k] = { v: e.v, t };
      }
      await tx`update users set prefs = ${tx.json(merged)} where id = ${auth.user.id}`;
      return merged as SyncedPrefs;
    });
    return { status: 200, body: { prefs } };
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
    // free accounts only see races within their last FREE_HISTORY_LIMIT, across all kinds
    const window = u.is_subscriber
      ? sql``
      : sql`and m.id in (select y.match_id from match_players y join matches z on z.id = y.match_id
          where y.user_id = ${u.id} and z.mode <> 'seed' order by z.finished_at desc limit ${FREE_HISTORY_LIMIT})`;
    const rows = await sql`
        select m.id, m.mode, m.status, m.finished_at, mp.placement, mp.wpm, mp.accuracy, mp.rating_delta, mp.finished,
          (select count(*)::int from match_players x where x.match_id = m.id) players,
          (select coalesce(ou.display_name, x.guest_name) from match_players x left join users ou on ou.id = x.user_id
             where x.match_id = m.id and x.slot <> mp.slot order by x.slot limit 1) opponent
        from match_players mp join matches m on m.id = mp.match_id
        where mp.user_id = ${u.id} and m.mode in ${sql(KIND_MODES[query.kind])} ${window}
        order by m.finished_at desc offset ${query.offset} limit ${PAGE + 1}`;
    const matches: MatchSummary[] = rows.slice(0, PAGE).map((r) => ({
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
    const more = rows.length > PAGE;
    let limited = false;
    if (!u.is_subscriber && !more) {
      const [c] = await sql`select count(*)::int n from match_players mp join matches m on m.id = mp.match_id
        where mp.user_id = ${u.id} and m.mode <> 'seed'`;
      limited = c!.n > FREE_HISTORY_LIMIT;
    }
    return { status: 200, body: { matches, more, limited } };
  },

  ratingHistory: async ({ params }) => {
    const u = await userByName(params.name);
    if (!u) return { status: 404, body: { message: "No such player." } };
    const season = await currentSeason();
    const rows = await sql`select * from (
        select rating, races, created_at, id from rating_history
        where user_id = ${u.id} and season_id = ${season.id}
        order by created_at desc, id desc limit ${HISTORY_POINTS}) t
      order by created_at, id`;
    const points = rows.map((r) => ({ at: r.created_at.toISOString(), rating: Math.round(r.rating), races: r.races }));
    // players new this season have no carried-over baseline; they started at the default
    if (points.length && points[0]!.races === 1 && rows.length < HISTORY_POINTS) {
      points.unshift({ at: season.starts_at.toISOString(), rating: DEFAULT_RATING, races: 0 });
    }
    return { status: 200, body: { season: { id: season.id, name: season.name }, points } };
  },

  search: async ({ query, req }) => {
    if (!(await rateLimit(`search:${req.ip}`, 120, 60))) {
      return { status: 429, body: { message: "Slow down a little." } };
    }
    const season = await currentSeason();
    const prefix = query.q.replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await sql`
      select u.display_name, u.country, u.is_subscriber, coalesce(r.rating, ${DEFAULT_RATING}) rating, coalesce(r.races, 0) races
      from users u left join ratings r on r.user_id = u.id and r.season_id = ${season.id}
      where u.display_name like ${prefix} and u.banned_at is null
      order by u.display_name = ${query.q} desc, length(u.display_name), u.display_name limit 8`;
    return {
      status: 200,
      body: {
        players: rows.map((r) => ({
          name: r.display_name,
          country: r.country,
          rating: Math.round(r.rating),
          races: r.races,
          subscriber: r.is_subscriber,
        })),
      },
    };
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
        funbox: Array.isArray(m.text_settings?.funbox) ? m.text_settings.funbox : undefined,
        rules: m.text_settings?.rules,
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
