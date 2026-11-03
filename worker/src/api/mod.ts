import { contract, MOD_STAT_MODES, MOD_USERS_PAGE, type ModStatMode, type ModStats } from "@mtr/contracts";
import { getAuth } from "../auth";
import { all, batch, bool, currentSeason, db, getRating, iso, json, one, q, run, type Row } from "../db";
import type { Http } from "../http";
import { s } from "./tsr";

const forbidden = { status: 403 as const, body: { message: "Moderators only." } };
const DAY = 86_400_000;
const n = (v: unknown) => Number(v ?? 0);

async function mod(h: Http) {
  const auth = await getAuth(h);
  return auth?.user.is_moderator ? auth.user : null;
}

/** Why this user can't be suspended, or null if they can. Moderators are left to the admins. */
async function cannotSuspend(userId: string) {
  const u = await one<{ is_moderator: number }>("select is_moderator from users where id = ?", userId);
  if (!u) return { status: 404 as const, body: { message: "No such player." } };
  if (u.is_moderator) return { status: 400 as const, body: { message: "Moderators can't be banned or timed out here." } };
  return null;
}

/** Ban a user and give back rating their recent ranked opponents lost to them. */
async function banUser(userId: string, reason: string | null) {
  const season = await currentSeason();
  const now = Date.now();
  // remember where they played from so signups from those addresses get flagged
  const u = await one<{ signup_ip: string | null; ban_ips: string }>("select signup_ip, ban_ips from users where id = ?", userId);
  const sessions = await all<{ ip: string | null }>("select distinct ip from sessions where user_id = ?", userId);
  const ips = new Set<string>(json<string[]>(u?.ban_ips, []));
  if (u?.signup_ip) ips.add(u.signup_ip);
  for (const s of sessions) if (s.ip) ips.add(s.ip);
  const losses = await all<{ user_id: string; rating_delta: number; id: string }>(
    `select o.user_id, o.rating_delta, m.id from matches m
    join match_players me on me.match_id = m.id and me.user_id = ?1
    join match_players o on o.match_id = m.id and o.user_id <> ?1
    where m.mode = 'ranked' and m.status = 'finished' and m.season_id = ?2
      and m.finished_at > ?3 and o.rating_delta < 0`,
    userId,
    season.id,
    now - 30 * DAY,
  );
  await batch([
    q("update users set banned_at = ?, suspension_reason = ?, ban_ips = ? where id = ?", now, reason, JSON.stringify([...ips]), userId),
    q("delete from sessions where user_id = ?", userId),
    ...losses.flatMap((l) => [
      q("update ratings set rating = rating - ?, updated_at = ? where user_id = ? and season_id = ?", l.rating_delta, now, l.user_id, season.id),
      q("update match_players set rating_delta = 0 where match_id = ? and user_id = ?", l.id, l.user_id),
    ]),
    q(
      "update matches set status = 'void' where mode = 'ranked' and id in (select match_id from match_players where user_id = ?)",
      userId,
    ),
  ]);
}

/** Keep a user out of ranked and casual for a while. A longer existing timeout is never shortened. */
async function timeoutUser(userId: string, hours: number, reason: string | null) {
  await run(
    "update users set suspension_reason = ?, timed_out_until = max(coalesce(timed_out_until, 0), ?) where id = ?",
    reason,
    Date.now() + hours * 3600_000,
    userId,
  );
}

/**
 * Every counted result on the site: finished races by signed-in players and guests
 * (not bots, not the ghost a player raced against, not seeded races) plus practice tests.
 */
const RESULTS = `
  select m.mode, m.id match_id, mp.user_id, m.finished_at at, mp.wpm, m.text_settings settings,
    coalesce(mp.duration_ms, mp.finished_at_ms, 0) duration_ms
  from match_players mp join matches m on m.id = mp.match_id left join users u on u.id = mp.user_id
  where m.status = 'finished' and m.mode in ('ranked', 'casual', 'ghost', 'private')
    and ((mp.user_id is null and mp.guest_name not like 'ghost of %') or not u.is_bot)
  union all
  select 'practice', null, p.user_id, p.created_at, p.wpm, p.text_settings, p.duration_ms
  from practice_results p join users u on u.id = p.user_id where not u.is_bot`;

export const modRouter = s.router(contract.mod, {
  reports: async (_, { h }) => {
    if (!(await mod(h))) return forbidden;
    const rows = await all(
      `select r.*, a.display_name reporter, b.display_name reported from reports r
      left join users a on a.id = r.reporter_id left join users b on b.id = r.reported_user_id
      where r.status = 'open' order by r.created_at limit 200`,
    );
    return {
      status: 200,
      body: {
        reports: rows.map((r) => ({
          id: Number(r.id),
          matchId: String(r.match_id),
          reason: String(r.reason),
          status: r.status as never,
          createdAt: iso(r.created_at),
          reporter: (r.reporter as string | null) ?? null,
          reported: (r.reported as string | null) ?? null,
          reportedId: (r.reported_user_id as string | null) ?? null,
          notes: (r.moderator_notes as string | null) ?? null,
        })),
      },
    };
  },

  resolveReport: async ({ params, body }, { h }) => {
    const m = await mod(h);
    if (!m) return forbidden;
    const r = await one<{ reported_user_id: string | null }>("select reported_user_id from reports where id = ?", params.id);
    if (!r) return { status: 404, body: { message: "No such report." } };
    const target = r.reported_user_id;
    if ((body.action === "ban" || body.action === "timeout") && target) {
      const no = await cannotSuspend(target);
      if (no) return no;
    }
    if (body.action === "ban" && target) await banUser(target, body.reason || null);
    if (body.action === "timeout" && target) {
      if (!body.hours) return { status: 400, body: { message: "Pick how long the timeout lasts." } };
      await timeoutUser(target, body.hours, body.reason || null);
    }
    if (body.action === "flag" && target) {
      await run("update users set flagged_at = coalesce(flagged_at, ?) where id = ?", Date.now(), target);
    }
    await run(
      "update reports set status = ?, moderator_notes = ?, resolved_at = ?, resolved_by = ? where id = ?",
      body.action === "dismiss" ? "dismissed" : "actioned",
      body.notes ?? null,
      Date.now(),
      m.id,
      params.id,
    );
    return { status: 200, body: { ok: true } };
  },

  held: async (_, { h }) => {
    if (!(await mod(h))) return forbidden;
    const rows = await all(
      `select m.id, m.finished_at,
        json_group_array(json_object('name', coalesce(u.display_name, mp.guest_name), 'wpm', mp.wpm, 'acc', mp.accuracy)) players
      from matches m join (select * from match_players order by placement) mp on mp.match_id = m.id
      left join users u on u.id = mp.user_id
      where m.status = 'held' group by m.id order by m.finished_at`,
    );
    return {
      status: 200,
      body: {
        matches: rows.map((r) => ({ matchId: String(r.id), finishedAt: iso(r.finished_at), players: json(r.players, []) })),
      },
    };
  },

  resolveHeld: async ({ params, body }, { h }) => {
    if (!(await mod(h))) return forbidden;
    const m = await one<{ id: string; season_id: number; rating_deltas: string | null }>(
      "select id, season_id, rating_deltas from matches where id = ? and status = 'held'",
      params.id,
    );
    if (!m) return { status: 404, body: { message: "No such held match." } };
    if (body.action === "void") {
      await run("update matches set status = 'void' where id = ?", m.id);
      return { status: 200, body: { ok: true } };
    }
    // approve: apply the pending rating changes computed when the race ended
    const pending = json<Record<string, { delta: number; rd: number; vol: number; won: boolean }>>(m.rating_deltas, {});
    const now = Date.now();
    const stmts: D1PreparedStatement[] = [];
    for (const [userId, p] of Object.entries(pending)) {
      const r = await getRating(userId, m.season_id);
      const rating = r.rating + p.delta;
      stmts.push(
        q(
          `insert into ratings (user_id, season_id, rating, rd, volatility, races, wins, peak, updated_at)
          values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?3, ?7)
          on conflict (user_id, season_id) do update set rating = ?3, rd = ?4, volatility = ?5,
            races = races + 1, wins = wins + ?6, peak = max(peak, ?3), updated_at = ?7`,
          userId,
          m.season_id,
          rating,
          p.rd,
          p.vol,
          p.won ? 1 : 0,
          now,
        ),
      );
    }
    stmts.push(q("update matches set status = 'finished' where id = ?", m.id));
    await batch(stmts);
    return { status: 200, body: { ok: true } };
  },

  flags: async (_, { h }) => {
    if (!(await mod(h))) return forbidden;
    const rows = await all(
      `select f.*, u.display_name, u.banned_at, u.timed_out_until from flags f join users u on u.id = f.user_id
      order by f.created_at desc limit 200`,
    );
    const now = Date.now();
    return {
      status: 200,
      body: {
        flags: rows.map((f) => ({
          id: Number(f.id),
          user: String(f.display_name),
          userId: String(f.user_id),
          matchId: (f.match_id as string | null) ?? null,
          reason: String(f.reason),
          details: json(f.details, null),
          createdAt: iso(f.created_at),
          bannedAt: f.banned_at == null ? null : iso(f.banned_at),
          timedOutUntil: n(f.timed_out_until) > now ? iso(f.timed_out_until) : null,
        })),
      },
    };
  },

  stats: async ({ query }, { h }) => {
    if (!(await mod(h))) return forbidden;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const todayMs = Date.parse(today);
    const first = await one<{ at: number | null }>("select min(created_at) at from users where not is_bot");
    // "all" runs from the UTC day of the first signup through today
    const utcDay = (ms: number) => Math.floor(ms / DAY);
    const days = query.range === "all" ? utcDay(now) - utcDay(first?.at ?? now) + 1 : Number(query.range);
    const fromMs = todayMs - (days - 1) * DAY;
    const R = `with r as materialized (${RESULTS})`;
    // one round trip for every query
    const res = await db().batch([
      q(
        `select count(*) total,
          count(*) filter (where email_verified_at is not null) verified,
          count(*) filter (where created_at > ?1 - 86400000) new1d,
          count(*) filter (where created_at > ?1 - 7 * 86400000) new7d,
          count(*) filter (where created_at > ?1 - 30 * 86400000) new30d,
          count(*) filter (where is_moderator) moderators,
          count(*) filter (where is_subscriber or early_supporter) supporters,
          count(*) filter (where early_supporter) early_supporters,
          count(*) filter (where banned_at is not null) banned,
          count(*) filter (where banned_at is null and timed_out_until > ?1) timed_out,
          count(*) filter (where flagged_at is not null) flagged,
          count(*) filter (where exists (select 1 from friendships f where f.status = 'accepted'
            and (f.requester_id = users.id or f.addressee_id = users.id))) with_friends
        from users where not is_bot`,
        now,
      ),
      q(
        `${R} select
          count(distinct user_id) filter (where at > ?1 - 86400000) active1d,
          count(distinct user_id) filter (where at > ?1 - 7 * 86400000) active7d,
          count(distinct user_id) filter (where at > ?1 - 30 * 86400000) active30d,
          count(*) total,
          count(*) filter (where at >= ?2) today,
          count(*) filter (where at > ?1 - 7 * 86400000) last7d,
          count(*) filter (where user_id is null) guests,
          coalesce(sum(duration_ms), 0) / 3600000.0 hours
        from r`,
        now,
        todayMs,
      ),
      q(
        `${R} select mode, count(*) tests, count(distinct coalesce(match_id, 'p' || at)) races,
          count(distinct user_id) players, count(*) filter (where at > ?1 - 7 * 86400000) last7d,
          coalesce(avg(wpm), 0) avg_wpm
        from r group by mode`,
        now,
      ),
      q(
        `${R} select case settings ->> '$.mode'
            when 'time' then 'time ' || (settings ->> '$.time')
            when 'words' then 'words ' || (settings ->> '$.words')
            when 'quote' then 'quote ' || coalesce(settings ->> '$.quoteLength', 'all')
            else settings ->> '$.mode' end label, count(*) tests
        from r group by 1 order by 2 desc limit 10`,
      ),
      q(
        `${R} select replace(coalesce(settings ->> '$.language', 'english'), '_', ' ') label, count(*) tests
        from r where settings ->> '$.mode' <> 'custom' group by 1 order by 2 desc limit 10`,
      ),
      q(`${R} select cast(strftime('%H', at / 1000, 'unixepoch') as integer) h, count(*) tests from r group by 1`),
      q(
        `with recursive d(day) as (
            select date(?1) union all select date(day, '+1 day') from d where day < date(?2)),
          r as (select date(at / 1000, 'unixepoch') day, mode, user_id from (${RESULTS}) where at >= ?3),
          s as (select date(created_at / 1000, 'unixepoch') day, count(*) c from users where not is_bot group by 1),
          a as (select day, count(distinct user_id) c from r group by 1),
          t as (select day, json_group_object(mode, c) tests from (select day, mode, count(*) c from r group by 1, 2) group by 1)
        select d.day date, coalesce(s.c, 0) signups,
          (select coalesce(sum(c), 0) from s where s.day < date(?1)) + sum(coalesce(s.c, 0)) over (order by d.day) users,
          coalesce(a.c, 0) active, coalesce(t.tests, '{}') tests
        from d left join s using (day) left join a using (day) left join t using (day)
        order by d.day`,
        new Date(fromMs).toISOString().slice(0, 10),
        today,
        fromMs,
      ),
      q(
        `select (select count(*) from reports where status = 'open') open_reports,
          (select count(*) from matches where status = 'held') held,
          (select count(*) from flags where created_at > ?1 - 7 * 86400000) flags7d,
          (select count(*) from reports where resolved_at > ?1 - 30 * 86400000) resolved30d`,
        now,
      ),
    ]);
    const rows = (i: number) => (res[i]?.results ?? []) as Row[];
    const [u] = rows(0);
    const [t] = rows(1);
    const modes = rows(2);
    const [m] = rows(7);
    const byHour = Array<number>(24).fill(0);
    for (const x of rows(5)) byHour[n(x.h)] = n(x.tests);
    const zero = Object.fromEntries(MOD_STAT_MODES.map((k) => [k, 0])) as Record<ModStatMode, number>;
    const body: ModStats = {
      users: {
        total: n(u?.total),
        verified: n(u?.verified),
        new1d: n(u?.new1d),
        new7d: n(u?.new7d),
        new30d: n(u?.new30d),
        active1d: n(t?.active1d),
        active7d: n(t?.active7d),
        active30d: n(t?.active30d),
        moderators: n(u?.moderators),
        supporters: n(u?.supporters),
        earlySupporters: n(u?.early_supporters),
        banned: n(u?.banned),
        timedOut: n(u?.timed_out),
        flagged: n(u?.flagged),
        withFriends: n(u?.with_friends),
      },
      tests: { total: n(t?.total), today: n(t?.today), last7d: n(t?.last7d), fromGuests: n(t?.guests), hoursTyped: n(t?.hours) },
      modes: MOD_STAT_MODES.map((mode) => {
        const r = modes.find((x) => x.mode === mode);
        return {
          mode,
          tests: n(r?.tests),
          races: n(r?.races),
          players: n(r?.players),
          last7d: n(r?.last7d),
          avgWpm: n(r?.avg_wpm),
        };
      }),
      testTypes: rows(3).map((r) => ({ label: String(r.label), tests: n(r.tests) })),
      languages: rows(4).map((r) => ({ label: String(r.label), tests: n(r.tests) })),
      hours: byHour,
      daily: rows(6).map((d) => ({
        date: String(d.date),
        signups: n(d.signups),
        users: n(d.users),
        active: n(d.active),
        tests: { ...zero, ...Object.fromEntries(Object.entries(json<Record<string, unknown>>(d.tests, {})).map(([k, v]) => [k, n(v)])) },
      })),
      moderation: { openReports: n(m?.open_reports), held: n(m?.held), flags7d: n(m?.flags7d), resolved30d: n(m?.resolved30d) },
    };
    return { status: 200, body };
  },

  users: async ({ query }, { h }) => {
    if (!(await mod(h))) return forbidden;
    const season = await currentSeason();
    const now = Date.now();
    const where: string[] = [];
    const args: unknown[] = [];
    if (query.q) {
      where.push("u.display_name like ? escape '\\'");
      args.push("%" + query.q.replace(/[\\%_]/g, "\\$&") + "%");
    }
    if (query.filter === "moderators") where.push("u.is_moderator");
    if (query.filter === "supporters") where.push("(u.is_subscriber or u.early_supporter)");
    if (query.filter === "suspended") {
      where.push("(u.banned_at is not null or u.timed_out_until > ?)");
      args.push(now);
    }
    if (query.filter === "flagged") where.push("u.flagged_at is not null");
    where.push(query.filter === "bots" ? "u.is_bot" : "not u.is_bot");
    const w = `where ${where.join(" and ")}`;
    const order = {
      newest: "u.created_at desc",
      oldest: "u.created_at",
      active: "last_seen is null, last_seen desc, u.created_at desc",
      tests: "tests desc, u.created_at desc",
      rating: "rating is null, rating desc, u.created_at desc",
      name: "u.display_name",
    }[query.sort];
    const [list, count] = await db().batch([
      q(
        `select u.id, u.display_name, u.country, u.created_at, u.email_verified_at is not null verified,
          u.is_moderator, u.is_bot, u.is_subscriber or u.early_supporter supporter, u.flagged_at is not null flagged,
          u.banned_at, u.timed_out_until, r.rating, r.races,
          (select max(last_seen_at) from sessions s where s.user_id = u.id) last_seen,
          (select count(*) from match_players mp join matches m on m.id = mp.match_id
            where mp.user_id = u.id and m.status = 'finished' and m.mode in ('ranked', 'casual', 'ghost', 'private'))
          + (select count(*) from practice_results p where p.user_id = u.id) tests
        from users u left join ratings r on r.user_id = u.id and r.season_id = ?
        ${w} order by ${order} limit ${MOD_USERS_PAGE} offset ${query.page * MOD_USERS_PAGE}`,
        season.id,
        ...args,
      ),
      q(`select count(*) c from users u ${w}`, ...args),
    ]);
    const rows = (list?.results ?? []) as Row[];
    return {
      status: 200,
      body: {
        total: n((count?.results?.[0] as Row | undefined)?.c),
        users: rows.map((r) => ({
          id: String(r.id),
          name: String(r.display_name),
          country: (r.country as string | null) ?? null,
          createdAt: iso(r.created_at),
          verified: bool(r.verified),
          moderator: bool(r.is_moderator),
          bot: bool(r.is_bot),
          supporter: bool(r.supporter),
          flagged: bool(r.flagged),
          bannedAt: r.banned_at == null ? null : iso(r.banned_at),
          timedOutUntil: n(r.timed_out_until) > now ? iso(r.timed_out_until) : null,
          rating: r.races ? Math.round(n(r.rating)) : null,
          tests: n(r.tests),
          lastSeen: r.last_seen == null ? null : iso(r.last_seen),
        })),
      },
    };
  },

  setModerator: async ({ params, body }, { h }) => {
    const m = await mod(h);
    if (!m) return forbidden;
    if (params.id === m.id) return { status: 400, body: { message: "You can't change your own moderator status." } };
    const u = await one<{ is_bot: number; banned_at: number | null }>("select is_bot, banned_at from users where id = ?", params.id);
    if (!u) return { status: 404, body: { message: "No such player." } };
    if (body.moderator && (u.is_bot || u.banned_at)) {
      return { status: 400, body: { message: "Bots and banned players can't be moderators." } };
    }
    await run("update users set is_moderator = ? where id = ?", body.moderator ? 1 : 0, params.id);
    return { status: 200, body: { ok: true } };
  },

  unflag: async ({ params }, { h }) => {
    if (!(await mod(h))) return forbidden;
    await run("update users set flagged_at = null where id = ?", params.id);
    return { status: 200, body: { ok: true } };
  },

  ban: async ({ params, body }, { h }) => {
    if (!(await mod(h))) return forbidden;
    const no = await cannotSuspend(params.id);
    if (no) return no;
    await banUser(params.id, body.reason || null);
    return { status: 200, body: { ok: true } };
  },

  timeout: async ({ params, body }, { h }) => {
    if (!(await mod(h))) return forbidden;
    const no = await cannotSuspend(params.id);
    if (no) return no;
    await timeoutUser(params.id, body.hours, body.reason || null);
    return { status: 200, body: { ok: true } };
  },

  unsuspend: async ({ params }, { h }) => {
    if (!(await mod(h))) return forbidden;
    // voided races and refunded rating from a ban stay as they are
    const r = await run(
      "update users set banned_at = null, timed_out_until = null, suspension_reason = null, ban_ips = '[]' where id = ?",
      params.id,
    );
    if (!r.changes) return { status: 404, body: { message: "No such player." } };
    return { status: 200, body: { ok: true } };
  },
});
