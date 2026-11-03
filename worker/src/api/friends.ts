import { contract, MAX_FRIENDS, type FriendRow, type FriendStatus } from "@mtr/contracts";
import { levelFromXp } from "@mtr/shared";
import { getAuth } from "../auth";
import { all, bool, iso, one, run } from "../db";
import { rateLimit } from "../http";
import { reportError } from "../sentry";
import { hub, s, unauth, type Ctx } from "./tsr";

/** Tell the Hub a friendship changed, so both players' lists and presence update live. */
const changed = (cx: ExecutionContext, ...ids: string[]) =>
  cx.waitUntil(hub().friendsChanged(ids).catch((e: unknown) => reportError("[friends] notify failed", e)));

type Row = { id: string; display_name: string; xp: number; country: string | null; is_subscriber: number; at: number };
const toRow = (r: Row): FriendRow => ({
  id: r.id,
  name: r.display_name,
  level: levelFromXp(r.xp).level,
  country: r.country,
  subscriber: bool(r.is_subscriber),
  since: iso(r.at),
});

async function statusWith(me: string, other: string): Promise<FriendStatus> {
  const f = await one<{ requester_id: string; status: string }>(
    `select requester_id, status from friendships
     where (requester_id = ?1 and addressee_id = ?2) or (requester_id = ?2 and addressee_id = ?1)`,
    me,
    other,
  );
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  return f.requester_id === me ? "outgoing" : "incoming";
}

export const friendsRouter = s.router(contract.friends, {
  list: async (_, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const rows = await all<Row & { status: string; mine: number }>(
      `select u.id, u.display_name, u.xp, u.country, u.is_subscriber, f.status, f.requester_id = ?1 mine,
        coalesce(f.accepted_at, f.created_at) at
      from friendships f
      join users u on u.id = case when f.requester_id = ?1 then f.addressee_id else f.requester_id end
      where (f.requester_id = ?1 or f.addressee_id = ?1) and u.banned_at is null
      order by u.display_name`,
      auth.user.id,
    );
    return {
      status: 200,
      body: {
        friends: rows.filter((r) => r.status === "accepted").map(toRow),
        incoming: rows.filter((r) => r.status === "pending" && !r.mine).map(toRow),
        outgoing: rows.filter((r) => r.status === "pending" && r.mine).map(toRow),
      },
    };
  },

  request: async ({ body }, { h, cx }: Ctx) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const me = auth.user.id;
    if (!(await rateLimit("normal", `friendreq:${me}`))) {
      return { status: 429, body: { message: "You've sent a lot of friend requests. Try again later." } };
    }
    const other = await one<{ id: string; is_bot: number }>(
      "select id, is_bot from users where display_name = ? and banned_at is null",
      body.name,
    );
    if (!other || other.is_bot) return { status: 404, body: { message: "No player with that name." } };
    if (other.id === me) return { status: 400, body: { message: "You can't add yourself." } };

    const current = await statusWith(me, other.id);
    if (current === "friends" || current === "outgoing") return { status: 200, body: { status: current, already: true } };
    if (current === "incoming") {
      // they already asked: adding them back accepts
      await run(
        "update friendships set status = 'accepted', accepted_at = ? where requester_id = ? and addressee_id = ?",
        Date.now(),
        other.id,
        me,
      );
      changed(cx, me, other.id);
      return { status: 200, body: { status: "friends" } };
    }
    const n = await one<{ n: number }>(
      `select (select count(*) from friendships where requester_id = ?1)
        + (select count(*) from friendships where addressee_id = ?1 and status = 'accepted') n`,
      me,
    );
    if ((n?.n ?? 0) >= MAX_FRIENDS) {
      return { status: 400, body: { message: `You can have up to ${MAX_FRIENDS} friends and pending requests.` } };
    }
    // the pair index makes a request that crossed theirs a no-op
    await run("insert or ignore into friendships (requester_id, addressee_id, created_at) values (?, ?, ?)", me, other.id, Date.now());
    changed(cx, me, other.id);
    return { status: 200, body: { status: await statusWith(me, other.id) } };
  },

  accept: async ({ params }, { h, cx }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const me = auth.user.id;
    const res = await run(
      "update friendships set status = 'accepted', accepted_at = ? where requester_id = ? and addressee_id = ? and status = 'pending'",
      Date.now(),
      params.id,
      me,
    );
    if (!res.changes) return { status: 404, body: { message: "That request is gone." } };
    changed(cx, me, params.id);
    return { status: 200, body: { ok: true } };
  },

  remove: async ({ params }, { h, cx }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const me = auth.user.id;
    const res = await run(
      `delete from friendships
       where (requester_id = ?1 and addressee_id = ?2) or (requester_id = ?2 and addressee_id = ?1)`,
      me,
      params.id,
    );
    if (res.changes) changed(cx, me, params.id);
    return { status: 200, body: { ok: true } };
  },
});
