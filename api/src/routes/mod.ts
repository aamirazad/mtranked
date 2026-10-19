import { initServer } from "@ts-rest/express";
import type { Request, Response } from "express";
import { contract, MOD_STAT_MODES, MOD_USERS_PAGE, type ModStatMode, type ModStats } from "@mtr/contracts";
import { sql, currentSeason, getRating } from "@mtr/db";
import { getAuth } from "../auth";

const s = initServer();
const forbidden = { status: 403 as const, body: { message: "Moderators only." } };

// typed as object: a route's parsed query (numbers, defaults) doesn't fit express's Request
async function mod(req: object, res: Response) {
  const auth = await getAuth(req as Request, res);
  return auth?.user.is_moderator ? auth.user : null;
}

/** Why this user can't be suspended, or null if they can. Moderators are left to the admins. */
async function cannotSuspend(userId: string) {
  const [u] = await sql`select is_moderator from users where id = ${userId}`;
  if (!u) return { status: 404 as const, body: { message: "No such player." } };
  if (u.is_moderator) return { status: 400 as const, body: { message: "Moderators can't be banned or timed out here." } };
  return null;
}

/** Ban a user and give back rating their recent ranked opponents lost to them. */
async function banUser(userId: string, reason: string | null) {
  const season = await currentSeason();
  await sql.begin(async (tx) => {
    // remember where they played from so signups from those addresses get flagged
    await tx`update users set banned_at = now(), suspension_reason = ${reason},
      ban_ips = array(select distinct ip from (
        select signup_ip ip from users where id = ${userId}
        union select ip from sessions where user_id = ${userId}
        union select unnest(ban_ips) from users where id = ${userId}) a where ip is not null)
      where id = ${userId}`;
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

/** Keep a user out of ranked and casual for a while. A longer existing timeout is never shortened. */
async function timeoutUser(userId: string, hours: number, reason: string | null) {
  await sql`update users set suspension_reason = ${reason},
    timed_out_until = greatest(timed_out_until, now() + make_interval(hours => ${hours}))
    where id = ${userId}`;
}

/**
 * Every counted result on the site: finished races by signed-in players and guests
 * (not bots, not the ghost a player raced against, not seeded races) plus practice tests.
 */
const results = () => sql`
  select m.mode, m.id match_id, mp.user_id, m.finished_at at, mp.wpm, m.text_settings settings,
    coalesce(mp.duration_ms, mp.finished_at_ms, 0) duration_ms
  from match_players mp join matches m on m.id = mp.match_id left join users u on u.id = mp.user_id
  where m.status = 'finished' and m.mode in ('ranked', 'casual', 'ghost', 'private')
    and (mp.user_id is null and mp.guest_name not like 'ghost of %' or not u.is_bot)
  union all
  select 'practice', null, p.user_id, p.created_at, p.wpm, p.text_settings, p.duration_ms
  from practice_results p join users u on u.id = p.user_id where not u.is_bot`;

const n = (v: unknown) => Number(v ?? 0);

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
    if ((body.action === "ban" || body.action === "timeout") && r.reported_user_id) {
      const no = await cannotSuspend(r.reported_user_id);
      if (no) return no;
    }
    if (body.action === "ban" && r.reported_user_id) await banUser(r.reported_user_id, body.reason || null);
    if (body.action === "timeout" && r.reported_user_id) {
      if (!body.hours) return { status: 400, body: { message: "Pick how long the timeout lasts." } };
      await timeoutUser(r.reported_user_id, body.hours, body.reason || null);
    }
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
    const rows = await sql`select f.*, u.display_name, u.banned_at, u.timed_out_until from flags f join users u on u.id = f.user_id
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
          bannedAt: f.banned_at?.toISOString() ?? null,
          timedOutUntil: f.timed_out_until > new Date() ? f.timed_out_until.toISOString() : null,
        })),
      },
    };
  },

  stats: async ({ req, res, query }) => {
    if (!(await mod(req, res))) return forbidden;
    const [first] = await sql`select min(created_at) at from users where not is_bot`;
    // "all" runs from the UTC day of the first signup through today
    const utcDay = (d: Date) => Math.floor(d.getTime() / 86_400_000);
    const days = query.range === "all" ? utcDay(new Date()) - utcDay(first?.at ?? new Date()) + 1 : Number(query.range);
    const [[u], [t], modes, testTypes, languages, hours, daily, [m]] = await Promise.all([
      sql`
        select count(*) total,
          count(*) filter (where email_verified_at is not null) verified,
          count(*) filter (where created_at > now() - interval '1 day') new1d,
          count(*) filter (where created_at > now() - interval '7 days') new7d,
          count(*) filter (where created_at > now() - interval '30 days') new30d,
          count(*) filter (where is_moderator) moderators,
          count(*) filter (where is_subscriber or early_supporter) supporters,
          count(*) filter (where early_supporter) early_supporters,
          count(*) filter (where banned_at is not null) banned,
          count(*) filter (where banned_at is null and timed_out_until > now()) timed_out,
          count(*) filter (where flagged_at is not null) flagged,
          count(*) filter (where exists (select 1 from friendships f where f.status = 'accepted'
            and (f.requester_id = users.id or f.addressee_id = users.id))) with_friends,
          (select count(distinct user_id) from (${results()}) r where at > now() - interval '1 day') active1d,
          (select count(distinct user_id) from (${results()}) r where at > now() - interval '7 days') active7d,
          (select count(distinct user_id) from (${results()}) r where at > now() - interval '30 days') active30d
        from users where not is_bot`,
      sql`
        select count(*) total,
          count(*) filter (where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') today,
          count(*) filter (where at > now() - interval '7 days') last7d,
          count(*) filter (where user_id is null) guests,
          coalesce(sum(duration_ms), 0) / 3600000.0 hours
        from (${results()}) r`,
      sql`
        select mode, count(*) tests, count(distinct coalesce(match_id::text, at::text)) races,
          count(distinct user_id) players, count(*) filter (where at > now() - interval '7 days') last7d,
          coalesce(avg(wpm), 0) avg_wpm
        from (${results()}) r group by mode`,
      sql`
        select case settings->>'mode'
            when 'time' then 'time ' || (settings->>'time')
            when 'words' then 'words ' || (settings->>'words')
            when 'quote' then 'quote ' || coalesce(settings->>'quoteLength', 'all')
            else settings->>'mode' end label, count(*) tests
        from (${results()}) r group by 1 order by 2 desc limit 10`,
      sql`
        select replace(coalesce(settings->>'language', 'english'), '_', ' ') label, count(*) tests
        from (${results()}) r where settings->>'mode' <> 'custom' group by 1 order by 2 desc limit 10`,
      sql`select extract(hour from at at time zone 'utc')::int h, count(*) tests from (${results()}) r group by 1`,
      sql`
        with d as (
          select generate_series(date_trunc('day', now() at time zone 'utc') - make_interval(days => ${days - 1}),
            date_trunc('day', now() at time zone 'utc'), interval '1 day')::date as day),
        r as (select (at at time zone 'utc')::date as day, mode, user_id from (${results()}) r
          where at >= (select min(day) from d)::timestamp at time zone 'utc'),
        s as (select (created_at at time zone 'utc')::date as day, count(*) c from users where not is_bot group by 1),
        a as (select day, count(distinct user_id) c from r group by 1),
        t as (select day, json_object_agg(mode, c) tests from (select day, mode, count(*) c from r group by 1, 2) x group by 1)
        select to_char(d.day, 'YYYY-MM-DD') date, coalesce(s.c, 0) signups,
          (select coalesce(sum(c), 0) from s where s.day < (select min(day) from d))
            + sum(coalesce(s.c, 0)) over (order by d.day) users,
          coalesce(a.c, 0) active, coalesce(t.tests, '{}') tests
        from d left join s using (day) left join a using (day) left join t using (day)
        order by d.day`,
      sql`
        select (select count(*) from reports where status = 'open') open_reports,
          (select count(*) from matches where status = 'held') held,
          (select count(*) from flags where created_at > now() - interval '7 days') flags7d,
          (select count(*) from reports where resolved_at > now() - interval '30 days') resolved30d`,
    ]);
    const byHour = Array<number>(24).fill(0);
    for (const h of hours) byHour[h.h] = n(h.tests);
    const zero = Object.fromEntries(MOD_STAT_MODES.map((k) => [k, 0])) as Record<ModStatMode, number>;
    const body: ModStats = {
      users: {
        total: n(u?.total),
        verified: n(u?.verified),
        new1d: n(u?.new1d),
        new7d: n(u?.new7d),
        new30d: n(u?.new30d),
        active1d: n(u?.active1d),
        active7d: n(u?.active7d),
        active30d: n(u?.active30d),
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
      testTypes: testTypes.map((r) => ({ label: r.label, tests: n(r.tests) })),
      languages: languages.map((r) => ({ label: r.label, tests: n(r.tests) })),
      hours: byHour,
      daily: daily.map((d) => ({
        date: d.date,
        signups: n(d.signups),
        users: n(d.users),
        active: n(d.active),
        tests: { ...zero, ...Object.fromEntries(Object.entries(d.tests as Record<string, unknown>).map(([k, v]) => [k, n(v)])) },
      })),
      moderation: { openReports: n(m?.open_reports), held: n(m?.held), flags7d: n(m?.flags7d), resolved30d: n(m?.resolved30d) },
    };
    return { status: 200, body };
  },

  users: async ({ req, res, query }) => {
    if (!(await mod(req, res))) return forbidden;
    const season = await currentSeason();
    const where = sql`where true
      ${query.q ? sql`and u.display_name ilike ${"%" + query.q.replace(/[\\%_]/g, "\\$&") + "%"}` : sql``}
      ${query.filter === "moderators" ? sql`and u.is_moderator` : sql``}
      ${query.filter === "supporters" ? sql`and (u.is_subscriber or u.early_supporter) and not u.is_bot` : sql``}
      ${query.filter === "suspended" ? sql`and (u.banned_at is not null or u.timed_out_until > now())` : sql``}
      ${query.filter === "flagged" ? sql`and u.flagged_at is not null` : sql``}
      ${query.filter === "bots" ? sql`and u.is_bot` : sql`and not u.is_bot`}`;
    const order = {
      newest: sql`u.created_at desc`,
      oldest: sql`u.created_at`,
      active: sql`last_seen desc nulls last, u.created_at desc`,
      tests: sql`tests desc, u.created_at desc`,
      rating: sql`rating desc nulls last, u.created_at desc`,
      name: sql`u.display_name`,
    }[query.sort];
    const [rows, [count]] = await Promise.all([
      sql`
        select u.id, u.display_name, u.country, u.created_at, u.email_verified_at is not null verified,
          u.is_moderator, u.is_bot, u.is_subscriber or u.early_supporter supporter, u.flagged_at is not null flagged,
          u.banned_at, u.timed_out_until, r.rating, r.races,
          (select max(last_seen_at) from sessions s where s.user_id = u.id) last_seen,
          (select count(*) from match_players mp join matches m on m.id = mp.match_id
            where mp.user_id = u.id and m.status = 'finished' and m.mode in ('ranked', 'casual', 'ghost', 'private'))
          + (select count(*) from practice_results p where p.user_id = u.id) tests
        from users u left join ratings r on r.user_id = u.id and r.season_id = ${season.id}
        ${where} order by ${order} limit ${MOD_USERS_PAGE} offset ${query.page * MOD_USERS_PAGE}`,
      sql`select count(*) from users u ${where}`,
    ]);
    return {
      status: 200,
      body: {
        total: n(count?.count),
        users: rows.map((r) => ({
          id: r.id,
          name: r.display_name,
          country: r.country,
          createdAt: r.created_at.toISOString(),
          verified: r.verified,
          moderator: r.is_moderator,
          bot: r.is_bot,
          supporter: r.supporter,
          flagged: r.flagged,
          bannedAt: r.banned_at?.toISOString() ?? null,
          timedOutUntil: r.timed_out_until > new Date() ? r.timed_out_until.toISOString() : null,
          rating: r.races ? Math.round(r.rating) : null,
          tests: n(r.tests),
          lastSeen: r.last_seen?.toISOString() ?? null,
        })),
      },
    };
  },

  setModerator: async ({ req, res, params, body }) => {
    const m = await mod(req, res);
    if (!m) return forbidden;
    if (params.id === m.id) return { status: 400, body: { message: "You can't change your own moderator status." } };
    const [u] = await sql`select is_bot, banned_at from users where id = ${params.id}`;
    if (!u) return { status: 404, body: { message: "No such player." } };
    if (body.moderator && (u.is_bot || u.banned_at)) {
      return { status: 400, body: { message: "Bots and banned players can't be moderators." } };
    }
    await sql`update users set is_moderator = ${body.moderator} where id = ${params.id}`;
    return { status: 200, body: { ok: true } };
  },

  unflag: async ({ req, res, params }) => {
    if (!(await mod(req, res))) return forbidden;
    await sql`update users set flagged_at = null where id = ${params.id}`;
    return { status: 200, body: { ok: true } };
  },

  ban: async ({ req, res, params, body }) => {
    if (!(await mod(req, res))) return forbidden;
    const no = await cannotSuspend(params.id);
    if (no) return no;
    await banUser(params.id, body.reason || null);
    return { status: 200, body: { ok: true } };
  },

  timeout: async ({ req, res, params, body }) => {
    if (!(await mod(req, res))) return forbidden;
    const no = await cannotSuspend(params.id);
    if (no) return no;
    await timeoutUser(params.id, body.hours, body.reason || null);
    return { status: 200, body: { ok: true } };
  },

  unsuspend: async ({ req, res, params }) => {
    if (!(await mod(req, res))) return forbidden;
    // voided races and refunded rating from a ban stay as they are
    const r = await sql`update users set banned_at = null, timed_out_until = null, suspension_reason = null, ban_ips = '{}'
      where id = ${params.id} returning id`;
    if (!r.length) return { status: 404, body: { message: "No such player." } };
    return { status: 200, body: { ok: true } };
  },
});
