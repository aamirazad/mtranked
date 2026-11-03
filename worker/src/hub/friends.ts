// Friends presence, all in the Hub's memory: a player is online while they have a socket here,
// and their activity (queued, in a match, in a private room) is set by the queue and rooms.
// Whoever changes either pushes the new presence to the player's friends.
import type { FriendActivity, FriendPresence } from "@mtr/race-protocol";
import { friendIds, friendsAmong } from "../db";
import { reportError } from "../sentry";
import { conns, deliver, type Conn } from "./core";

const FRIENDS_TTL_MS = 60_000;

/** Guests can't have friends, so they have no presence either. */
export const isUser = (id: string) => !id.startsWith("g_") && !id.startsWith("ghost:");

const cache = new Map<string, { ids: string[]; at: number }>();
export async function friendsOf(id: string): Promise<string[]> {
  if (!isUser(id)) return [];
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < FRIENDS_TTL_MS) return hit.ids;
  const ids = await friendIds(id);
  cache.set(id, { ids, at: Date.now() });
  // don't let the cache grow with players who left long ago
  if (cache.size > 5000) for (const [k, v] of cache) if (Date.now() - v.at > FRIENDS_TTL_MS) cache.delete(k);
  return ids;
}

/** Which of `others` are friends of `id` (checked against the database, not the cache). */
export async function friendsWith(id: string, others: string[]): Promise<Set<string>> {
  return isUser(id) ? friendsAmong(id, others.filter(isUser)) : new Set();
}

type StoredActivity = FriendActivity & { tag: string };
const activities = new Map<string, StoredActivity>();
/** Which queue a player is in, so a room ending can show them as queued again. */
let queuedMode: (id: string) => "ranked" | "casual" | null = () => null;
export const setQueuedModeLookup = (fn: typeof queuedMode) => (queuedMode = fn);

export function presenceOf(ids: string[]): Record<string, FriendPresence> {
  const out: Record<string, FriendPresence> = {};
  for (const id of ids) {
    const online = conns.has(id);
    const a = activities.get(id);
    let activity: FriendActivity | null = null;
    if (online && a) {
      const { tag: _tag, ...rest } = a;
      activity = rest;
    }
    out[id] = { online, activity };
  }
  return out;
}

const fire = (p: Promise<unknown>) => void p.catch((e) => reportError("[friends] presence update failed", e));

/** Tell the player's friends what they're up to now. */
export function pushPresence(id: string) {
  if (!isUser(id)) return;
  fire(
    friendsOf(id).then((friends) => {
      if (!friends.length) return;
      deliver(friends, { type: "friend.presence", id, presence: presenceOf([id])[id]! });
    }),
  );
}

/** Send a player the presence of all their friends. */
export async function sendFriendsSnapshot(conn: Conn) {
  if (conn.idn.guest) return;
  const friends = await friendsOf(conn.id);
  conn.send({ type: "friends.presence", presence: presenceOf(friends) });
}

/**
 * Record what a player is doing. `tag` names the owner (a room id, or "queue") so it can
 * only clear its own activity. Unchanged updates aren't pushed again.
 */
export function setActivity(id: string, activity: FriendActivity, tag: string) {
  if (!isUser(id)) return;
  const next = { ...activity, tag };
  const prev = activities.get(id);
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  activities.set(id, next);
  pushPresence(id);
}

/** The room or queue `tag` is done with this player. If they're still queued, they show as queued again. */
export function clearActivity(id: string, tag: string) {
  if (!isUser(id)) return;
  const a = activities.get(id);
  if (!a || a.tag !== tag) return;
  activities.delete(id);
  const mode = tag !== "queue" ? queuedMode(id) : null;
  if (mode) return setActivity(id, { kind: "queue", mode }, "queue");
  pushPresence(id);
}

/** The API changed a friendship: refresh both players' lists and presence. */
export function friendsChanged(ids: string[]) {
  for (const id of ids) {
    cache.delete(id);
    const c = conns.get(id);
    if (!c) continue;
    c.send({ type: "friends.changed" });
    fire(sendFriendsSnapshot(c));
  }
}

/** Nothing is happening any more (about to allow hibernation): activity is all stale. */
export const resetPresence = () => activities.clear();
