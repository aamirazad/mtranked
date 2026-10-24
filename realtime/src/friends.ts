// Friends presence. Each signed-in player has two Redis keys their friends'
// lists are built from: `online:<id>` (the node holding their socket,
// refreshed while it's open) and `act:<id>` (what they're doing: queued, in a
// match or in a private room). Whoever changes either pushes the new presence
// to the player's friends, wherever they're connected.
import { friendIds, friendsAmong } from "@mtr/db";
import type { FriendActivity, FriendPresence } from "@mtr/race-protocol";
import { conns, deliver, listen, type Conn } from "./hub";
import { NODE_ID, redis } from "./redis";
import { reportError } from "./sentry";

const ONLINE_TTL_S = 90;
const ACT_TTL_S = 3600;
const FRIENDS_TTL_MS = 60_000;

/** Guests can't have friends, so they have no presence either. */
export const isUser = (id: string) => !id.startsWith("g_");

const cache = new Map<string, { ids: string[]; at: number }>();
export async function friendsOf(id: string): Promise<string[]> {
  if (!isUser(id)) return [];
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < FRIENDS_TTL_MS) return hit.ids;
  const ids = await friendIds(id);
  cache.set(id, { ids, at: Date.now() });
  return ids;
}

/** Which of `others` are friends of `id` (checked against the database, not the cache). */
export async function friendsWith(id: string, others: string[]): Promise<Set<string>> {
  return isUser(id) ? friendsAmong(id, others.filter(isUser)) : new Set();
}

type StoredActivity = FriendActivity & { tag: string };

export async function presenceOf(ids: string[]): Promise<Record<string, FriendPresence>> {
  if (!ids.length) return {};
  const [online, acts] = await Promise.all([
    redis.mget(ids.map((id) => `online:${id}`)),
    redis.mget(ids.map((id) => `act:${id}`)),
  ]);
  const out: Record<string, FriendPresence> = {};
  ids.forEach((id, i) => {
    const on = !!online[i];
    const raw = acts[i];
    let activity: FriendActivity | null = null;
    if (on && raw) {
      const { tag: _tag, ...a } = JSON.parse(raw) as StoredActivity;
      activity = a;
    }
    out[id] = { online: on, activity };
  });
  return out;
}

/** Tell the player's friends what they're up to now. */
export async function pushPresence(id: string) {
  const friends = await friendsOf(id);
  if (!friends.length) return;
  const p = (await presenceOf([id]))[id]!;
  deliver(friends, { type: "friend.presence", id, presence: p });
}

/** Send a player the presence of all their friends. */
export async function sendFriendsSnapshot(conn: Conn) {
  if (conn.idn.guest) return;
  const friends = await friendsOf(conn.id);
  conn.send({ type: "friends.presence", presence: await presenceOf(friends) });
}

const fire = (p: Promise<unknown>) => void p.catch((e) => reportError("[friends] presence update failed", e));

export function setOnline(id: string) {
  if (!isUser(id)) return;
  fire(redis.set(`online:${id}`, NODE_ID, "EX", ONLINE_TTL_S).then(() => pushPresence(id)));
}

export function setOffline(id: string) {
  if (!isUser(id)) return;
  fire(
    (async () => {
      // only if a newer socket on another node hasn't taken over
      if ((await redis.get(`online:${id}`)) === NODE_ID) await redis.del(`online:${id}`);
      await pushPresence(id);
    })(),
  );
}

/** last activity this node wrote per player, so unchanged room updates don't spam friends */
const written = new Map<string, string>();

/**
 * Record what a player is doing. `tag` names the owner (a room id, or
 * "queue") so it can only clear its own activity.
 */
export function setActivity(id: string, activity: FriendActivity, tag: string) {
  if (!isUser(id)) return;
  const json = JSON.stringify({ ...activity, tag });
  // a room lives on one node, so only rooms dedupe; queue changes can come from any node
  if (tag !== "queue") {
    if (written.get(id) === json) return;
    written.set(id, json);
  } else written.delete(id);
  fire(redis.set(`act:${id}`, json, "EX", ACT_TTL_S).then(() => pushPresence(id)));
}

/** The room or queue `tag` is done with this player. If they're still queued, they show as queued again. */
export function clearActivity(id: string, tag: string) {
  if (!isUser(id)) return;
  fire(
    (async () => {
      const raw = await redis.get(`act:${id}`);
      if (!raw || (JSON.parse(raw) as StoredActivity).tag !== tag) return;
      written.delete(id);
      const queued = tag !== "queue" ? await redis.hget("qmeta", id) : null;
      if (queued) {
        const mode = (JSON.parse(queued) as { mode: "ranked" | "casual" }).mode;
        return setActivity(id, { kind: "queue", mode }, "queue");
      }
      await redis.del(`act:${id}`);
      await pushPresence(id);
    })(),
  );
}

// keep `online:` alive for every socket on this node
setInterval(() => {
  const multi = redis.multi();
  let n = 0;
  for (const c of conns.values()) {
    if (c.idn.guest) continue;
    multi.set(`online:${c.id}`, NODE_ID, "EX", ONLINE_TTL_S);
    n++;
  }
  if (n) fire(multi.exec());
}, 30_000).unref();

// the API changed a friendship: refresh both players' lists and presence
await listen("mtr:friends", (data) => {
  const { ids } = data as { ids: string[] };
  for (const id of ids) {
    cache.delete(id);
    const c = conns.get(id);
    if (!c) continue;
    c.send({ type: "friends.changed" });
    fire(sendFriendsSnapshot(c));
  }
});
