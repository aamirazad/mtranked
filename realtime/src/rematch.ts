// Casual rematches. After a clean 1v1 casual race the offer sits in Redis for
// a short window; either player can ask to run it back, and once both have,
// whichever node sees the second request starts a new room carrying the
// running series score.
import { REMATCH_MS, type PlayerPublic } from "@mtr/race-protocol";
import { conns, deliver, sendTo, type Conn } from "./hub";
import { queueMeta } from "./matchmaker";
import type { Identity } from "./players";
import { redis } from "./redis";
import { Room, roomOf, type Member } from "./room";

type Offer = {
  players: { idn: Pick<Identity, "id" | "guest" | "name">; info: PlayerPublic }[];
  series: Record<string, number>;
};

const offerKey = (matchId: string) => `rematch:${matchId}`;
const requestKey = (matchId: string) => `rematch:${matchId}:req`;

export async function offerRematch(matchId: string, members: Member[], series: Record<string, number>) {
  const offer: Offer = {
    players: members.map((m) => ({ idn: { id: m.idn.id, guest: m.idn.guest, name: m.idn.name }, info: m.info })),
    series,
  };
  await redis.set(offerKey(matchId), JSON.stringify(offer), "PX", REMATCH_MS);
}

async function getOffer(matchId: string): Promise<Offer | null> {
  const raw = await redis.get(offerKey(matchId));
  return raw ? (JSON.parse(raw) as Offer) : null;
}

async function busy(id: string): Promise<boolean> {
  return !!roomOf(id) || !!(await redis.exists(`proom:${id}`)) || !!(await queueMeta(id));
}

export async function requestRematch(conn: Conn, matchId: string) {
  const offer = await getOffer(matchId);
  if (!offer) {
    return sendTo(conn.id, { type: "rematch.status", matchId, requested: [], closed: "The rematch offer expired." });
  }
  const ids = offer.players.map((p) => p.idn.id);
  if (!ids.includes(conn.id)) return;
  const res = await redis
    .multi()
    .sadd(requestKey(matchId), conn.id)
    .pexpire(requestKey(matchId), REMATCH_MS)
    .smembers(requestKey(matchId))
    .exec();
  const requested = ((res?.[2]?.[1] as string[] | undefined) ?? []).filter((id) => ids.includes(id));
  deliver(ids, { type: "rematch.status", matchId, requested });
  if (requested.length < ids.length) return;

  // only one node gets to start the rematch
  if ((await redis.del(offerKey(matchId))) !== 1) return;
  await redis.del(requestKey(matchId));
  for (const p of offer.players) {
    if (await busy(p.idn.id)) {
      return deliver(ids, { type: "rematch.status", matchId, requested, closed: `${p.info.name} is no longer available.` });
    }
  }
  const members: Member[] = offer.players.map((p) => ({
    idn: conns.get(p.idn.id)?.idn ?? { ...p.idn },
    info: p.info,
    connected: true,
    dcAt: null,
    ready: true,
  }));
  await Room.createRematch(members, offer.series);
}

export async function declineRematch(id: string, matchId: string) {
  const offer = await getOffer(matchId);
  const me = offer?.players.find((p) => p.idn.id === id);
  if (!offer || !me) return;
  await redis.del(offerKey(matchId), requestKey(matchId));
  const others = offer.players.map((p) => p.idn.id).filter((x) => x !== id);
  deliver(others, { type: "rematch.status", matchId, requested: [], closed: `${me.info.name} left, so no rematch this time.` });
}
