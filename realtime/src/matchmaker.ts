// Matchmaking queue. Each queued player is a Redis sorted-set entry scored by
// rating; every second the node holding the matcher lock pairs the closest
// two players whose search ranges overlap.
import { randomInt } from "node:crypto";
import { sql, currentSeason, type RatingRow } from "@mtr/db";
import type { QueueMode, PlayerPublic } from "@mtr/race-protocol";
import { resolveEquipped, levelFromXp } from "@mtr/shared";
import { sendTo, conns, holdNotice } from "./hub";
import { NODE_ID, redis } from "./redis";
import { reportError } from "./sentry";
import { Room, roomOf, type Member, type GhostSource } from "./room";
import { showBanner, type Identity } from "./players";

const META = "qmeta";
const GHOST_AFTER_MS = 60_000;
const QUEUE_GRACE_MS = 15_000;

type QueueKey = "q:ranked" | "q:ranked:shadow" | "q:casual";
type Meta = {
  key: QueueKey;
  mode: QueueMode;
  since: number;
  idn: Pick<Identity, "id" | "guest" | "name">;
  info: PlayerPublic;
  rating: RatingRow | null;
  dcAt?: number;
};

export function searchRange(mode: QueueMode, waitMs: number): number {
  const steps = Math.floor(waitMs / 5000);
  // casual searches wider and opens up faster
  return mode === "ranked" ? Math.min(50 + 25 * steps, 400) : Math.min(150 + 100 * steps, 3000);
}

async function getMeta(id: string): Promise<Meta | null> {
  const raw = await redis.hget(META, id);
  return raw ? (JSON.parse(raw) as Meta) : null;
}

export async function enqueue(
  idn: Identity,
  info: PlayerPublic,
  mode: QueueMode,
  rating: RatingRow | null,
  flagged: boolean,
  since = Date.now(),
) {
  const key: QueueKey = mode === "casual" ? "q:casual" : flagged ? "q:ranked:shadow" : "q:ranked";
  const meta: Meta = { key, mode, since, idn: { id: idn.id, guest: idn.guest, name: idn.name }, info, rating };
  await redis.multi().zadd(key, rating?.rating ?? 1500, idn.id).hset(META, idn.id, JSON.stringify(meta)).exec();
  sendStatus(meta, 1);
}

export async function dequeue(id: string, reason?: string) {
  const meta = await getMeta(id);
  if (!meta) return false;
  await redis.multi().zrem(meta.key, id).hdel(META, id).exec();
  sendTo(id, { type: "queue.left", reason });
  return true;
}

export async function queueMeta(id: string) {
  return getMeta(id);
}

/**
 * Asked to join the queue they're already in (e.g. the page reloaded): keep
 * their place and wait time instead of starting over.
 */
export async function resumeQueue(id: string, mode: QueueMode): Promise<boolean> {
  const meta = await getMeta(id);
  if (meta?.mode !== mode) return false;
  await markReconnected(id);
  return true;
}

/**
 * Player's socket dropped: keep their spot for the grace period so a page
 * reload or a short network blip doesn't cost them their place.
 */
export async function markDisconnected(id: string) {
  const meta = await getMeta(id);
  if (!meta) return;
  meta.dcAt = Date.now();
  await redis.hset(META, id, JSON.stringify(meta));
}

/** Returns whether the player is still queued. */
export async function markReconnected(id: string): Promise<boolean> {
  const meta = await getMeta(id);
  if (!meta) return false;
  delete meta.dcAt;
  await redis.hset(META, id, JSON.stringify(meta));
  sendStatus(meta, await redis.zcard(meta.key));
  return true;
}

export async function requeue(m: Member, mode: QueueMode) {
  const flagged = m.idn.user?.flagged_at != null;
  await enqueue(m.idn, m.info, mode, m.rating ?? null, flagged, m.queueSince ?? Date.now());
}

export const STRIKE_LIMIT = 3;

/**
 * Declines and missed ready checks are strikes; STRIKE_LIMIT in 10
 * minutes = 5 minute queue timeout. Returns how many strikes are left before
 * the timeout (0 means this one started it).
 */
export async function recordDecline(id: string): Promise<number> {
  const n = await redis.incr(`declines:${id}`);
  if (n === 1) await redis.expire(`declines:${id}`, 600);
  if (n >= STRIKE_LIMIT) {
    await redis.set(`qban:${id}`, "1", "EX", 300);
    await redis.del(`declines:${id}`);
    return 0;
  }
  return STRIKE_LIMIT - n;
}

/** What to tell a player about the strike they just got. */
export function strikeWarning(what: string, left: number) {
  return left === 0
    ? `${what}. That's ${STRIKE_LIMIT} declines in 10 minutes, so the queue is locked for 5 minutes.`
    : `${what}. ${left} more decline${left === 1 ? "" : "s"} within 10 minutes and you'll be locked out of the queue for 5 minutes.`;
}

export async function queueBanLeft(id: string): Promise<number> {
  return Math.max(0, await redis.ttl(`qban:${id}`));
}

function sendStatus(meta: Meta, size: number) {
  const wait = Date.now() - meta.since;
  sendTo(meta.idn.id, {
    type: "queue.status",
    mode: meta.mode,
    rating: Math.round(meta.rating?.rating ?? 1500),
    since: meta.since,
    range: searchRange(meta.mode, wait),
    size,
    ghostAvailable: wait >= GHOST_AFTER_MS && meta.mode === "ranked",
  });
}

// ------------------------------------------------------------------ matcher loop
async function holdLock(): Promise<boolean> {
  const got = await redis.set("lock:matcher", NODE_ID, "PX", 3000, "NX");
  if (got) return true;
  if ((await redis.get("lock:matcher")) === NODE_ID) {
    await redis.pexpire("lock:matcher", 3000);
    return true;
  }
  return false;
}

async function matchQueue(key: QueueKey) {
  const ids = await redis.zrange(key, 0, -1);
  if (!ids.length) return;
  const raws = await redis.hmget(META, ...ids);
  const now = Date.now();
  const entries: Meta[] = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = raws[i];
    if (!raw) {
      await redis.zrem(key, ids[i]!);
      continue;
    }
    const m = JSON.parse(raw) as Meta;
    if (m.dcAt && now - m.dcAt > QUEUE_GRACE_MS) {
      await redis.multi().zrem(key, m.idn.id).hdel(META, m.idn.id).exec();
      await holdNotice(m.idn.id, "You were away for a while, so you were taken out of the queue.");
      continue;
    }
    entries.push(m);
  }

  const lastOpp = new Map<string, string | null>();
  const opps = entries.length ? await redis.mget(...entries.map((e) => `lastopp:${e.idn.id}`)) : [];
  entries.forEach((e, i) => lastOpp.set(e.idn.id, opps[i] ?? null));
  const nearlyEmpty = entries.length <= 3;

  const taken = new Set<string>();
  const byWait = [...entries].sort((a, b) => a.since - b.since);
  for (const a of byWait) {
    if (taken.has(a.idn.id) || a.dcAt) continue;
    const ra = a.rating?.rating ?? 1500;
    const rangeA = searchRange(a.mode, now - a.since);
    let best: Meta | null = null;
    let bestDiff = Infinity;
    for (const b of entries) {
      if (b === a || taken.has(b.idn.id) || b.dcAt) continue;
      const rb = b.rating?.rating ?? 1500;
      const diff = Math.abs(ra - rb);
      if (diff > rangeA + searchRange(b.mode, now - b.since)) continue;
      if (!nearlyEmpty && (lastOpp.get(a.idn.id) === b.idn.id || lastOpp.get(b.idn.id) === a.idn.id)) continue;
      if (diff < bestDiff) {
        best = b;
        bestDiff = diff;
      }
    }
    if (!best) continue;
    const res = await redis.multi().zrem(key, a.idn.id).zrem(key, best.idn.id).hdel(META, a.idn.id, best.idn.id).exec();
    if (!res || res[0]![1] !== 1 || res[1]![1] !== 1) continue;
    taken.add(a.idn.id).add(best.idn.id);
    await redis
      .multi()
      .set(`lastopp:${a.idn.id}`, best.idn.id, "EX", 600)
      .set(`lastopp:${best.idn.id}`, a.idn.id, "EX", 600)
      .exec();
    createMatch(a, best);
  }

  const size = entries.length - taken.size;
  for (const e of entries) if (!taken.has(e.idn.id) && !e.dcAt) sendStatus(e, size);
}

function createMatch(a: Meta, b: Meta) {
  const members: Member[] = [a, b].map((m) => {
    // a queued player may be racing a ghost while they wait: drop that race
    const existing = roomOf(m.idn.id);
    if (existing?.mode === "ghost") existing.close();
    const local = conns.get(m.idn.id);
    return {
      idn: local?.idn ?? { ...m.idn },
      info: m.info,
      connected: true,
      dcAt: null,
      ready: false,
      rating: m.rating ?? undefined,
      queueSince: m.since,
    };
  });
  Room.createMatch(a.mode, members);
}

let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try {
    if (await holdLock()) {
      await matchQueue("q:ranked");
      await matchQueue("q:ranked:shadow");
      await matchQueue("q:casual");
    }
  } catch (e) {
    reportError("[matcher]", e);
  } finally {
    running = false;
  }
}, 1000).unref();

// ------------------------------------------------------------------ ghost races
export async function startGhostRace(idn: Identity, info: PlayerPublic): Promise<string | null> {
  const meta = await getMeta(idn.id);
  if (!meta || meta.mode !== "ranked") return "Ghost races are offered while you wait in the ranked queue.";
  if (Date.now() - meta.since < GHOST_AFTER_MS) return "Ghost races unlock after a minute in queue.";
  if (roomOf(idn.id)) return "You're already in a race.";
  const season = await currentSeason();
  const rating = meta.rating?.rating ?? 1500;
  const rows = await sql`
    select m.id, m.text, r.keystrokes, u.display_name, u.equipped, u.xp, rt.rating, rt.races
    from match_players mp
    join matches m on m.id = mp.match_id
    join replays r on r.match_id = mp.match_id and r.slot = mp.slot
    join users u on u.id = mp.user_id
    left join ratings rt on rt.user_id = mp.user_id and rt.season_id = ${season.id}
    where m.mode in ('ranked', 'casual', 'seed') and m.status = 'finished' and mp.finished
      and u.banned_at is null and u.flagged_at is null and mp.user_id <> ${idn.guest ? null : idn.id}
      and m.text_settings @> '{"mode":"words","words":50,"language":"english","punctuation":false,"numbers":false}'
    order by abs(coalesce(rt.rating, mp.rating_before, 1500) - ${rating}) limit 8`;
  if (!rows.length) return "No ghosts available yet.";
  const g = rows[randomInt(rows.length)]!;
  const eq = resolveEquipped(g.equipped);
  const source: GhostSource = {
    matchId: g.id,
    text: g.text,
    keys: g.keystrokes,
    info: {
      id: `ghost:${g.id}`,
      name: g.display_name,
      guest: false,
      ghost: true,
      // only ghosts with a rating this season show one
      rating: g.rating == null ? undefined : Math.round(g.rating),
      races: g.races ?? undefined,
      level: levelFromXp(g.xp).level,
      caretColor: eq.caretColor,
      caretShape: eq.caretShape,
      banner: showBanner(eq.banner),
      subscriber: false,
    },
  };
  await Room.createGhost({ idn, info, connected: true, dcAt: null, ready: true }, source);
  return null;
}
