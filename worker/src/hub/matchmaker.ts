// Matchmaking queue, in the Hub's memory. Every second (hub/index.ts) the matcher pairs the
// closest two players in each queue whose search ranges overlap.
import type { PlayerPublic, QueueMode } from "@mtr/race-protocol";
import { levelFromXp, resolveEquipped } from "@mtr/shared";
import { all, currentSeason, json, type RatingRow } from "../db";
import { randomInt } from "../crypto";
import { unpackKeys } from "../keys";
import { conns, holdNotice, sendTo, store } from "./core";
import { clearActivity, setActivity } from "./friends";
import { showBanner, type Identity } from "./players";
import { Room, roomOf, type GhostSource, type Member } from "./room";

const GHOST_AFTER_MS = 60_000;
const QUEUE_GRACE_MS = 15_000;
const LASTOPP_MS = 600_000;

type QueueKey = "ranked" | "ranked:shadow" | "casual";
type Meta = {
  key: QueueKey;
  mode: QueueMode;
  since: number;
  idn: Pick<Identity, "id" | "guest" | "name">;
  info: PlayerPublic;
  rating: RatingRow | null;
  dcAt?: number;
};

const queue = new Map<string, Meta>();
/** who each player last faced, to avoid back-to-back rematches */
const lastOpp = new Map<string, { id: string; at: number }>();

export const queueSize = () => queue.size;
export const queuedMode = (id: string) => queue.get(id)?.mode ?? null;

export function searchRange(mode: QueueMode, waitMs: number): number {
  const steps = Math.floor(waitMs / 5000);
  // casual searches wider and opens up faster
  return mode === "ranked" ? Math.min(50 + 25 * steps, 400) : Math.min(150 + 100 * steps, 3000);
}

const sizeOf = (key: QueueKey) => {
  let n = 0;
  for (const m of queue.values()) if (m.key === key) n++;
  return n;
};

export function enqueue(idn: Identity, info: PlayerPublic, mode: QueueMode, rating: RatingRow | null, flagged: boolean, since = Date.now()) {
  const key: QueueKey = mode === "casual" ? "casual" : flagged ? "ranked:shadow" : "ranked";
  const meta: Meta = { key, mode, since, idn: { id: idn.id, guest: idn.guest, name: idn.name }, info, rating };
  queue.set(idn.id, meta);
  sendStatus(meta, sizeOf(key));
  setActivity(idn.id, { kind: "queue", mode }, "queue");
}

export function dequeue(id: string, reason?: string) {
  if (!queue.delete(id)) return false;
  sendTo(id, { type: "queue.left", reason });
  clearActivity(id, "queue");
  return true;
}

export const queueMeta = (id: string) => queue.get(id) ?? null;

/**
 * Asked to join the queue they're already in (e.g. the page reloaded): keep
 * their place and wait time instead of starting over.
 */
export function resumeQueue(id: string, mode: QueueMode): boolean {
  if (queue.get(id)?.mode !== mode) return false;
  markReconnected(id);
  return true;
}

/** Socket dropped: keep their spot for the grace period so a reload or blip doesn't cost them their place. */
export function markDisconnected(id: string) {
  const meta = queue.get(id);
  if (meta) meta.dcAt = Date.now();
}

/** Returns whether the player is still queued. */
export function markReconnected(id: string): boolean {
  const meta = queue.get(id);
  if (!meta) return false;
  delete meta.dcAt;
  sendStatus(meta, sizeOf(meta.key));
  return true;
}

export function requeue(m: Member, mode: QueueMode) {
  const flagged = m.idn.user?.flagged_at != null;
  enqueue(m.idn, m.info, mode, m.rating ?? null, flagged, m.queueSince ?? Date.now());
}

export const STRIKE_LIMIT = 3;

/**
 * Declines and missed ready checks are strikes; STRIKE_LIMIT in 10 minutes = 5 minute
 * queue timeout. Returns how many strikes are left before the timeout (0 means this one
 * started it). Kept in durable storage so a restart doesn't wipe a lockout.
 */
export function recordDecline(id: string): number {
  const n = Number(store.get(`declines:${id}`) ?? 0) + 1;
  if (n >= STRIKE_LIMIT) {
    store.set(`qban:${id}`, "1", 300_000);
    store.del(`declines:${id}`);
    return 0;
  }
  store.update(`declines:${id}`, String(n), 600_000);
  return STRIKE_LIMIT - n;
}

/** What to tell a player about the strike they just got. */
export function strikeWarning(what: string, left: number) {
  return left === 0
    ? `${what}. That's ${STRIKE_LIMIT} declines in 10 minutes, so the queue is locked for 5 minutes.`
    : `${what}. ${left} more decline${left === 1 ? "" : "s"} within 10 minutes and you'll be locked out of the queue for 5 minutes.`;
}

/** Seconds left on a queue lockout. */
export const queueBanLeft = (id: string) => Math.ceil(store.ttl(`qban:${id}`) / 1000);

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

// ------------------------------------------------------------------ matcher
function matchQueue(key: QueueKey, now: number) {
  const entries: Meta[] = [];
  for (const m of queue.values()) {
    if (m.key !== key) continue;
    if (m.dcAt && now - m.dcAt > QUEUE_GRACE_MS) {
      queue.delete(m.idn.id);
      holdNotice(m.idn.id, "You were away for a while, so you were taken out of the queue.");
      clearActivity(m.idn.id, "queue");
      continue;
    }
    entries.push(m);
  }
  if (!entries.length) return;
  const nearlyEmpty = entries.length <= 3;
  const facedLast = (a: string, b: string) => {
    const l = lastOpp.get(a);
    return !!l && l.id === b && now - l.at < LASTOPP_MS;
  };

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
      const diff = Math.abs(ra - (b.rating?.rating ?? 1500));
      if (diff > rangeA + searchRange(b.mode, now - b.since)) continue;
      if (!nearlyEmpty && (facedLast(a.idn.id, b.idn.id) || facedLast(b.idn.id, a.idn.id))) continue;
      if (diff < bestDiff) {
        best = b;
        bestDiff = diff;
      }
    }
    if (!best) continue;
    queue.delete(a.idn.id);
    queue.delete(best.idn.id);
    taken.add(a.idn.id).add(best.idn.id);
    lastOpp.set(a.idn.id, { id: best.idn.id, at: now });
    lastOpp.set(best.idn.id, { id: a.idn.id, at: now });
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
    return {
      idn: conns.get(m.idn.id)?.idn ?? { ...m.idn },
      info: m.info,
      connected: conns.has(m.idn.id),
      dcAt: conns.has(m.idn.id) ? null : Date.now(),
      ready: false,
      rating: m.rating ?? undefined,
      queueSince: m.since,
    };
  });
  Room.createMatch(a.mode, members);
}

/** One matcher pass over every queue (called once a second while anyone is queued). */
export function runMatcher(now = Date.now()) {
  matchQueue("ranked", now);
  matchQueue("ranked:shadow", now);
  matchQueue("casual", now);
  if (lastOpp.size > 1000) for (const [k, v] of lastOpp) if (now - v.at > LASTOPP_MS) lastOpp.delete(k);
}

// ------------------------------------------------------------------ ghost races
export async function startGhostRace(idn: Identity, info: PlayerPublic): Promise<string | null> {
  const meta = queue.get(idn.id);
  if (!meta || meta.mode !== "ranked") return "Ghost races are offered while you wait in the ranked queue.";
  if (Date.now() - meta.since < GHOST_AFTER_MS) return "Ghost races unlock after a minute in queue.";
  if (roomOf(idn.id)) return "You're already in a race.";
  const season = await currentSeason();
  const rating = meta.rating?.rating ?? 1500;
  // Candidates are the 2000 most recent eligible matches (served by matches_ghost_pool_idx, whose
  // predicate must stay in sync with this where clause); replays are read only for the final 8.
  const rows = await all(
    `with recent as (
      select m.id, m.text from matches m
      where m.mode in ('ranked', 'casual', 'seed') and m.status = 'finished'
        and m.text_settings ->> '$.mode' = 'words' and m.text_settings ->> '$.words' = 50
        and m.text_settings ->> '$.language' = 'english' and m.text_settings ->> '$.punctuation' = 0
        and m.text_settings ->> '$.numbers' = 0
      order by m.finished_at desc limit 2000
    ), pick as (
      select m.id, m.text, mp.slot, u.display_name, u.equipped, u.xp, rt.rating, rt.races
      from recent m
      join match_players mp on mp.match_id = m.id
      join users u on u.id = mp.user_id
      left join ratings rt on rt.user_id = mp.user_id and rt.season_id = ?1
      where mp.finished and u.banned_at is null and u.flagged_at is null and mp.user_id is not ?2
        and exists (select 1 from replays r where r.match_id = mp.match_id and r.slot = mp.slot)
      order by abs(coalesce(rt.rating, mp.rating_before, 1500) - ?3) limit 8
    )
    select p.id, p.text, r.keystrokes, p.display_name, p.equipped, p.xp, p.rating, p.races
    from pick p join replays r on r.match_id = p.id and r.slot = p.slot`,
    season.id,
    idn.guest ? null : idn.id,
    rating,
  );
  if (!rows.length) return "No ghosts available yet.";
  const g = rows[randomInt(rows.length)]!;
  const eq = resolveEquipped(json(g.equipped, null));
  const source: GhostSource = {
    matchId: String(g.id),
    text: String(g.text),
    keys: unpackKeys(g.keystrokes),
    info: {
      id: `ghost:${g.id}`,
      name: String(g.display_name),
      guest: false,
      ghost: true,
      // only ghosts with a rating this season show one
      rating: g.rating == null ? undefined : Math.round(Number(g.rating)),
      races: g.races == null ? undefined : Number(g.races),
      level: levelFromXp(Number(g.xp)).level,
      caretColor: eq.caretColor,
      caretShape: eq.caretShape,
      banner: showBanner(eq.banner),
      subscriber: false,
    },
  };
  // they may have been matched (or left) while we looked
  if (!queue.has(idn.id) || roomOf(idn.id)) return null;
  await Room.createGhost({ idn, info, connected: true, dcAt: null, ready: true }, source);
  return null;
}
