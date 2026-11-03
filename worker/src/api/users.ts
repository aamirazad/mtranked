import { contract, type MatchSummary, type SyncedPrefs } from "@mtr/contracts";
import {
  COSMETICS,
  DEFAULT_EQUIPPED,
  DEFAULT_RATING,
  FREE_HISTORY_LIMIT,
  OFFENSIVE_NAME_MESSAGE,
  isOffensiveName,
  levelFromXp,
  resolveEquipped,
  type Equipped,
} from "@mtr/shared";
import { buildMe, getAuth, nextNameChange } from "../auth";
import { all, bool, currentSeason, getRating, getUser, iso, isUuid, json, one, run, unlockedCosmetics } from "../db";
import { rateLimit } from "../http";
import { unpackKeys } from "../keys";
import { activity, profileStats, wpmHistory, type StatsUser } from "./stats";
import { s, unauth } from "./tsr";

const PAGE = 20;
const HISTORY_POINTS = 1000;
const KIND_MODES = { ranked: ["ranked"], casual: ["casual", "ghost"], private: ["private"] };
type Prefs = Record<string, { v: string | number | boolean; t: number }>;

export const meRouter = s.router(contract.me, {
  update: async ({ body }, { h }) => {
    const auth = await getAuth(h);
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
      if (await one("select 1 from users where display_name = ?", name)) {
        return { status: 409, body: { message: "That name is taken.", fields: { displayName: "Taken" } } };
      }
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
    try {
      await run(
        `update users set display_name = ?, country = ?, equipped = ?, name_changed_at = ? where id = ?`,
        body.displayName ?? u.display_name,
        body.country === undefined ? u.country : body.country,
        JSON.stringify(equipped),
        renaming ? Date.now() : u.name_changed_at,
        u.id,
      );
    } catch (e) {
      if (String(e).includes("UNIQUE")) return { status: 409, body: { message: "That name is taken.", fields: { displayName: "Taken" } } };
      throw e;
    }
    return { status: 200, body: { user: await buildMe((await getUser(u.id))!) } };
  },

  prefs: async ({ body }, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    // a client clock running ahead mustn't make its changes win forever
    const now = Date.now();
    // optimistic merge: retry if another tab wrote in between
    for (let attempt = 0; ; attempt++) {
      const row = await one<{ prefs: string }>("select prefs from users where id = ?", auth.user.id);
      const before = row?.prefs ?? "{}";
      const merged: Prefs = { ...json<Prefs>(before, {}) };
      let changed = false;
      for (const [k, e] of Object.entries(body)) {
        if (!e) continue;
        const t = Math.min(e.t, now);
        if (!merged[k] || merged[k].t < t) {
          merged[k] = { v: e.v, t };
          changed = true;
        }
      }
      if (!changed) return { status: 200, body: { prefs: merged as SyncedPrefs } };
      const res = await run("update users set prefs = ? where id = ? and prefs = ?", JSON.stringify(merged), auth.user.id, before);
      if (res.changes || attempt >= 3) return { status: 200, body: { prefs: merged as SyncedPrefs } };
    }
  },

  cosmetics: async (_, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const unlocked = await unlockedCosmetics(auth.user);
    return {
      status: 200,
      body: { unlocked: [...unlocked], equipped: { ...DEFAULT_EQUIPPED, ...(auth.user.equipped as Partial<Equipped>) } },
    };
  },
});

type NamedUser = StatsUser & { display_name: string; country: string | null; is_subscriber: boolean; xp: number; equipped: Partial<Equipped> };

async function userByName(name: string): Promise<NamedUser | undefined> {
  const r = await one(
    `select id, display_name, country, created_at, is_subscriber, xp, equipped, is_bot, flagged_at
     from users where display_name = ? and banned_at is null`,
    name,
  );
  if (!r) return undefined;
  return {
    id: String(r.id),
    display_name: String(r.display_name),
    country: (r.country as string | null) ?? null,
    created_at: Number(r.created_at),
    is_subscriber: bool(r.is_subscriber),
    xp: Number(r.xp),
    equipped: json(r.equipped, {}),
    is_bot: bool(r.is_bot),
    flagged_at: (r.flagged_at as number | null) ?? null,
  };
}

const noPlayer = { status: 404 as const, body: { message: "No such player." } };

export const usersRouter = s.router(contract.users, {
  profile: async ({ params }) => {
    const u = await userByName(params.name);
    if (!u) return noPlayer;
    const season = await currentSeason();
    const [r, seasons, st] = await Promise.all([
      getRating(u.id, season.id),
      all(
        `select r.season_id, s.name, r.peak, r.races from ratings r
         join seasons s on s.id = r.season_id where r.user_id = ? order by r.season_id desc`,
        u.id,
      ),
      one(
        `select coalesce(avg(wpm), 0) avg_wpm, coalesce(max(wpm), 0) best_wpm, coalesce(avg(accuracy), 0) avg_acc, count(*) total
         from (select wpm, accuracy from match_players mp join matches m on m.id = mp.match_id
               where mp.user_id = ? and mp.finished and m.status <> 'void'
               order by m.finished_at desc limit 50) t`,
        u.id,
      ),
    ]);
    const eq = resolveEquipped(u.equipped);
    return {
      status: 200,
      body: {
        profile: {
          id: u.id,
          name: u.display_name,
          country: u.country,
          createdAt: iso(u.created_at),
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
            seasonId: Number(x.season_id),
            name: String(x.name),
            peak: Math.round(Number(x.peak)),
            races: Number(x.races),
            current: Number(x.season_id) === season.id,
          })),
          stats: {
            avgWpm: Math.round(Number(st?.avg_wpm ?? 0)),
            bestWpm: Math.round(Number(st?.best_wpm ?? 0)),
            avgAcc: Math.round(Number(st?.avg_acc ?? 0) * 10) / 10,
            total: Number(st?.total ?? 0),
          },
        },
      },
    };
  },

  matches: async ({ params, query }) => {
    const u = await userByName(params.name);
    if (!u) return noPlayer;
    const modes = KIND_MODES[query.kind];
    // free accounts only see races within their last FREE_HISTORY_LIMIT, across all kinds
    const window = u.is_subscriber
      ? ""
      : `and m.id in (select y.match_id from match_players y join matches z on z.id = y.match_id
          where y.user_id = ?1 and z.mode <> 'seed' order by z.finished_at desc limit ${FREE_HISTORY_LIMIT})`;
    const rows = await all(
      `select m.id, m.mode, m.status, m.finished_at, mp.placement, mp.wpm, mp.accuracy, mp.rating_delta, mp.finished,
        (select count(*) from match_players x where x.match_id = m.id) players,
        (select coalesce(ou.display_name, x.guest_name) from match_players x left join users ou on ou.id = x.user_id
           where x.match_id = m.id and x.slot <> mp.slot order by x.slot limit 1) opponent
      from match_players mp join matches m on m.id = mp.match_id
      where mp.user_id = ?1 and m.mode in (${modes.map((x) => `'${x}'`).join(", ")}) ${window}
      order by m.finished_at desc limit ${PAGE + 1} offset ?2`,
      u.id,
      query.offset,
    );
    const matches: MatchSummary[] = rows.slice(0, PAGE).map((r) => ({
      matchId: String(r.id),
      mode: r.mode as MatchSummary["mode"],
      status: r.status as MatchSummary["status"],
      finishedAt: iso(r.finished_at),
      placement: Number(r.placement),
      players: Number(r.players),
      wpm: Number(r.wpm),
      acc: Number(r.accuracy),
      delta: (r.rating_delta as number | null) ?? null,
      finished: bool(r.finished),
      opponent: Number(r.players) === 2 ? ((r.opponent as string | null) ?? null) : null,
    }));
    const more = rows.length > PAGE;
    let limited = false;
    if (!u.is_subscriber && !more) {
      const c = await one<{ n: number }>(
        `select count(*) n from match_players mp join matches m on m.id = mp.match_id where mp.user_id = ? and m.mode <> 'seed'`,
        u.id,
      );
      limited = (c?.n ?? 0) > FREE_HISTORY_LIMIT;
    }
    return { status: 200, body: { matches, more, limited } };
  },

  ratingHistory: async ({ params }) => {
    const u = await userByName(params.name);
    if (!u) return noPlayer;
    const season = await currentSeason();
    const rows = await all<{ rating: number; races: number; created_at: number }>(
      `select * from (
          select rating, races, created_at, id from rating_history
          where user_id = ? and season_id = ?
          order by created_at desc, id desc limit ${HISTORY_POINTS}) t
        order by created_at, id`,
      u.id,
      season.id,
    );
    const points = rows.map((r) => ({ at: iso(r.created_at), rating: Math.round(r.rating), races: r.races }));
    // players new this season have no carried-over baseline; they started at the default
    if (points.length && points[0]!.races === 1 && rows.length < HISTORY_POINTS) {
      points.unshift({ at: iso(season.starts_at), rating: DEFAULT_RATING, races: 0 });
    }
    return { status: 200, body: { season: { id: season.id, name: season.name }, points } };
  },

  stats: async ({ params }) => {
    const u = await userByName(params.name);
    if (!u) return noPlayer;
    return { status: 200, body: { stats: await profileStats(u) } };
  },

  wpmHistory: async ({ params, query }) => {
    const u = await userByName(params.name);
    if (!u) return noPlayer;
    return { status: 200, body: { points: await wpmHistory(u, query.kind) } };
  },

  activity: async ({ params, query }) => {
    const u = await userByName(params.name);
    if (!u) return noPlayer;
    return { status: 200, body: await activity(u, query.year) };
  },

  search: async ({ query }, { h }) => {
    if (!(await rateLimit("loose", `search:${h.ip}`))) return { status: 429, body: { message: "Slow down a little." } };
    const season = await currentSeason();
    const prefix = query.q.replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await all(
      `select u.display_name, u.country, u.is_subscriber, coalesce(r.rating, ?) rating, coalesce(r.races, 0) races
      from users u left join ratings r on r.user_id = u.id and r.season_id = ?
      where u.display_name like ? escape '\\' and u.banned_at is null
      order by u.display_name = ? desc, length(u.display_name), u.display_name limit 8`,
      DEFAULT_RATING,
      season.id,
      prefix,
      query.q,
    );
    return {
      status: 200,
      body: {
        players: rows.map((r) => ({
          name: String(r.display_name),
          country: (r.country as string | null) ?? null,
          rating: Math.round(Number(r.rating)),
          races: Number(r.races),
          subscriber: bool(r.is_subscriber),
        })),
      },
    };
  },
});

export const leaderboardRoute = s.route(contract.leaderboard, async ({ query }) => {
  const season = await currentSeason();
  const country = query.country?.toUpperCase() ?? null;
  const rows = await all(
    `select r.user_id, u.display_name, u.country, u.is_subscriber, r.rating, r.races, r.wins
    from ratings r join users u on u.id = r.user_id
    where r.season_id = ?1 and r.races >= 5 and u.banned_at is null and u.flagged_at is null and not u.is_bot
      and (?2 is null or u.country = ?2)
    order by r.rating desc limit 100`,
    season.id,
    country,
  );
  return {
    status: 200,
    body: {
      season: { id: season.id, name: season.name, endsAt: iso(season.ends_at) },
      rows: rows.map((r, i) => ({
        rank: i + 1,
        id: String(r.user_id),
        name: String(r.display_name),
        country: (r.country as string | null) ?? null,
        rating: Math.round(Number(r.rating)),
        races: Number(r.races),
        wins: Number(r.wins),
        subscriber: bool(r.is_subscriber),
      })),
    },
  };
});

export const seasonRoute = s.route(contract.season, async () => {
  const season = await currentSeason();
  return {
    status: 200,
    body: { id: season.id, name: season.name, startsAt: iso(season.starts_at), endsAt: iso(season.ends_at) },
  };
});

export const matchRoute = s.route(contract.match, async ({ params }) => {
  if (!isUuid(params.id)) return { status: 404, body: { message: "Match not found." } };
  const m = await one("select * from matches where id = ?", params.id);
  if (!m) return { status: 404, body: { message: "Match not found." } };
  const players = await all(
    `select mp.*, u.display_name, u.equipped, r.keystrokes
    from match_players mp left join users u on u.id = mp.user_id
    left join replays r on r.match_id = mp.match_id and r.slot = mp.slot
    where mp.match_id = ? order by mp.placement`,
    m.id,
  );
  const settings = json<{ funbox?: unknown; rules?: unknown }>(m.text_settings, {});
  return {
    status: 200,
    body: {
      match: {
        id: String(m.id),
        mode: m.mode as never,
        status: m.status as never,
        text: String(m.text),
        seed: String(m.seed),
        funbox: Array.isArray(settings.funbox) ? (settings.funbox as never) : undefined,
        rules: settings.rules as never,
        startedAt: iso(m.started_at),
        finishedAt: iso(m.finished_at),
        players: players.map((p) => ({
          slot: Number(p.slot),
          userId: (p.user_id as string | null) ?? null,
          name: String(p.display_name ?? p.guest_name ?? "deleted"),
          placement: Number(p.placement),
          wpm: Number(p.wpm),
          raw: Number(p.raw),
          acc: Number(p.accuracy),
          timeMs: (p.finished_at_ms as number | null) ?? null,
          finished: bool(p.finished),
          forfeit: bool(p.forfeit),
          delta: (p.rating_delta as number | null) ?? null,
          caretColor: resolveEquipped(json(p.equipped, null)).caretColor,
          keystrokes: p.keystrokes == null ? null : unpackKeys(p.keystrokes),
        })),
      },
    },
  };
});

export const reportRoute = s.route(contract.report, async ({ body }, { h }) => {
  const auth = await getAuth(h);
  if (!auth) return unauth;
  if (!(await rateLimit("strict", `report:${auth.user.id}`))) {
    return { status: 429, body: { message: "You've sent a lot of reports. Try again later." } };
  }
  if (!(await one("select 1 from matches where id = ?", body.matchId))) return { status: 400, body: { message: "Unknown match." } };
  await run(
    "insert into reports (reporter_id, match_id, reported_user_id, reason, created_at) values (?, ?, ?, ?, ?)",
    auth.user.id,
    body.matchId,
    body.reportedUserId ?? null,
    body.reason,
    Date.now(),
  );
  return { status: 200, body: { ok: true } };
});
