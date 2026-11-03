// Casual rematches. After a clean 1v1 casual race the offer stays open for REMATCH_MS;
// either player can ask to run it back, and once both have, a new room starts carrying the
// running series score.
import { REMATCH_MS, type PlayerPublic } from "@mtr/race-protocol";
import { getUser, suspension } from "../db";
import { conns, deliver, sendTo, type Conn } from "./core";
import { queueMeta } from "./matchmaker";
import type { Identity } from "./players";
import { Room, roomOf, type Member } from "./room";

type Offer = {
  players: { idn: Pick<Identity, "id" | "guest" | "name">; info: PlayerPublic }[];
  series: Record<string, number>;
  requested: Set<string>;
  expires: number;
};

const offers = new Map<string, Offer>();

/** Offers still open (expired ones are dropped). */
export function openOffers(now = Date.now()) {
  for (const [id, o] of offers) if (o.expires <= now) offers.delete(id);
  return offers.size;
}

export function offerRematch(matchId: string, members: Member[], series: Record<string, number>) {
  offers.set(matchId, {
    players: members.map((m) => ({ idn: { id: m.idn.id, guest: m.idn.guest, name: m.idn.name }, info: m.info })),
    series,
    requested: new Set(),
    expires: Date.now() + REMATCH_MS,
  });
}

function getOffer(matchId: string): Offer | null {
  const o = offers.get(matchId);
  if (!o) return null;
  if (o.expires <= Date.now()) {
    offers.delete(matchId);
    return null;
  }
  return o;
}

const busy = (id: string) => !!roomOf(id) || !!queueMeta(id);

export async function requestRematch(conn: Conn, matchId: string) {
  const offer = getOffer(matchId);
  if (!offer) return sendTo(conn.id, { type: "rematch.status", matchId, requested: [], closed: "The rematch offer expired." });
  const ids = offer.players.map((p) => p.idn.id);
  if (!ids.includes(conn.id)) return;
  const user = conn.idn.guest ? undefined : await getUser(conn.id);
  const suspended = user && suspension(user);
  if (suspended) return sendTo(conn.id, { type: "error", code: "suspended", message: suspended });
  // the offer may have been taken while we read the account
  if (offers.get(matchId) !== offer) return;
  offer.requested.add(conn.id);
  const requested = [...offer.requested];
  deliver(ids, { type: "rematch.status", matchId, requested });
  if (requested.length < ids.length) return;

  offers.delete(matchId);
  for (const p of offer.players) {
    if (busy(p.idn.id)) {
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

export function declineRematch(id: string, matchId: string) {
  const offer = getOffer(matchId);
  const me = offer?.players.find((p) => p.idn.id === id);
  if (!offer || !me) return;
  offers.delete(matchId);
  const others = offer.players.map((p) => p.idn.id).filter((x) => x !== id);
  deliver(others, { type: "rematch.status", matchId, requested: [], closed: `${me.info.name} left, so no rematch this time.` });
}
