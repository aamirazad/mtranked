import { initServer } from "@ts-rest/express";
import { contract, MAX_FRIENDS, type FriendRow, type FriendStatus } from "@mtr/contracts";
import { sql } from "@mtr/db";
import { levelFromXp } from "@mtr/shared";
import { getAuth } from "../auth";
import { rateLimit, redis } from "../redis";

const s = initServer();
const unauth = { status: 401 as const, body: { message: "Sign in first." } };

/** Tell the realtime servers a friendship changed, so both players' lists and presence update live. */
const changed = (...ids: string[]) => redis.publish("mtr:friends", JSON.stringify({ ids })).catch(() => {});

type Row = { id: string; display_name: string; xp: number; country: string | null; is_subscriber: boolean; at: Date };
const toRow = (r: Row): FriendRow => ({
  id: r.id,
  name: r.display_name,
  level: levelFromXp(r.xp).level,
  country: r.country,
  subscriber: r.is_subscriber,
  since: r.at.toISOString(),
});

async function statusWith(me: string, other: string): Promise<FriendStatus> {
  const [f] = await sql<{ requester_id: string; status: string }[]>`
    select requester_id, status from friendships
    where (requester_id = ${me} and addressee_id = ${other}) or (requester_id = ${other} and addressee_id = ${me})`;
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  return f.requester_id === me ? "outgoing" : "incoming";
}

export const friendsRouter = s.router(contract.friends, {
  list: async ({ req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const me = auth.user.id;
    const rows = await sql<(Row & { status: string; mine: boolean })[]>`
      select u.id, u.display_name, u.xp, u.country, u.is_subscriber, f.status, f.requester_id = ${me} mine,
        coalesce(f.accepted_at, f.created_at) at
      from friendships f
      join users u on u.id = case when f.requester_id = ${me} then f.addressee_id else f.requester_id end
      where (f.requester_id = ${me} or f.addressee_id = ${me}) and u.banned_at is null
      order by u.display_name`;
    return {
      status: 200,
      body: {
        friends: rows.filter((r) => r.status === "accepted").map(toRow),
        incoming: rows.filter((r) => r.status === "pending" && !r.mine).map(toRow),
        outgoing: rows.filter((r) => r.status === "pending" && r.mine).map(toRow),
      },
    };
  },

  request: async ({ body, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const me = auth.user.id;
    if (!(await rateLimit(`friendreq:${me}`, 30, 3600))) {
      return { status: 429, body: { message: "You've sent a lot of friend requests. Try again later." } };
    }
    const [other] = await sql<{ id: string; is_bot: boolean }[]>`
      select id, is_bot from users where display_name = ${body.name} and banned_at is null`;
    if (!other || other.is_bot) return { status: 404, body: { message: "No player with that name." } };
    if (other.id === me) return { status: 400, body: { message: "You can't add yourself." } };

    const current = await statusWith(me, other.id);
    if (current === "friends") return { status: 200, body: { status: "friends" } };
    if (current === "outgoing") return { status: 200, body: { status: "outgoing" } };
    if (current === "incoming") {
      // they already asked: adding them back accepts
      await sql`update friendships set status = 'accepted', accepted_at = now()
        where requester_id = ${other.id} and addressee_id = ${me}`;
      await changed(me, other.id);
      return { status: 200, body: { status: "friends" } };
    }
    const [n] = await sql<{ n: number }[]>`select count(*)::int n from friendships
      where requester_id = ${me} or (addressee_id = ${me} and status = 'accepted')`;
    if (n!.n >= MAX_FRIENDS) {
      return { status: 400, body: { message: `You can have up to ${MAX_FRIENDS} friends and pending requests.` } };
    }
    // the pair index makes a request that crossed theirs a no-op
    await sql`insert into friendships (requester_id, addressee_id) values (${me}, ${other.id}) on conflict do nothing`;
    await changed(me, other.id);
    return { status: 200, body: { status: await statusWith(me, other.id) } };
  },

  accept: async ({ params, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const me = auth.user.id;
    const rows = await sql`update friendships set status = 'accepted', accepted_at = now()
      where requester_id = ${params.id} and addressee_id = ${me} and status = 'pending' returning 1`;
    if (!rows.length) return { status: 404, body: { message: "That request is gone." } };
    await changed(me, params.id);
    return { status: 200, body: { ok: true } };
  },

  remove: async ({ params, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const me = auth.user.id;
    const rows = await sql`delete from friendships
      where (requester_id = ${me} and addressee_id = ${params.id}) or (requester_id = ${params.id} and addressee_id = ${me})
      returning 1`;
    if (rows.length) await changed(me, params.id);
    return { status: 200, body: { ok: true } };
  },

  status: async ({ params, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return unauth;
    const [other] = await sql<{ id: string }[]>`select id from users where display_name = ${params.name} and banned_at is null`;
    if (!other) return { status: 404, body: { message: "No such player." } };
    return { status: 200, body: { status: await statusWith(auth.user.id, other.id) } };
  },
});
