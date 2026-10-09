// Local socket registry plus Redis pub/sub so rooms owned by one realtime
// node can reach players connected to another (sticky sessions keep each
// socket on one node; rooms live on the node that created them).
import type { WebSocket } from "ws";
import type { PlayerPublic, ServerMsg } from "@mtr/race-protocol";
import type { Identity } from "./players";
import { liveNodes, NODE_ID, redis, sub } from "./redis";

export class Conn {
  rtts: number[] = [];
  pingSentAt = 0;
  alive = true;
  constructor(
    public ws: WebSocket,
    public idn: Identity,
    public info: PlayerPublic,
  ) {}
  get id() {
    return this.idn.id;
  }
  send(msg: ServerMsg) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }
  /** Median round trip of recent pings, in ms. */
  rtt(): number {
    if (!this.rtts.length) return 100;
    const s = [...this.rtts].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
}

export const conns = new Map<string, Conn>();

const DELIVER = "mtr:deliver";
const nodeChannel = (id: string) => `mtr:node:${id}`;

export function deliver(ids: Iterable<string>, msg: ServerMsg) {
  const remote: string[] = [];
  let json: string | undefined;
  for (const id of ids) {
    const c = conns.get(id);
    if (c) {
      json ??= JSON.stringify(msg);
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(json);
    } else remote.push(id);
  }
  if (remote.length && multiNode) void redis.publish(DELIVER, JSON.stringify({ from: NODE_ID, ids: remote, msg }));
}

export const sendTo = (id: string, msg: ServerMsg) => deliver([id], msg);

/** Hold a message for a player who's offline; it's shown when they reconnect. */
export async function holdNotice(id: string, message: string) {
  await redis.set(`notice:${id}`, message, "EX", 1800);
}

/** Why an offline player lost their private room, held until they reconnect. */
export type RoomGone = { code?: string; reason: string; rejoin: boolean };
export async function holdRoomGone(id: string, gone: RoomGone) {
  await redis.set(`roomgone:${id}`, JSON.stringify(gone), "EX", 3600);
}

export const rttOf = (id: string) => conns.get(id)?.rtt() ?? remoteRtt.get(id) ?? 100;
const remoteRtt = new Map<string, number>();

/** Forwarded room message from a player connected to another node. */
export type Forwarded = { from: string; rtt: number; msg: { type: string; [k: string]: unknown } };
let onForward: (f: Forwarded) => void = () => {};
export function setForwardHandler(fn: (f: Forwarded) => void) {
  onForward = fn;
}
export async function forward(node: string, f: Forwarded) {
  await redis.publish(nodeChannel(node), JSON.stringify(f));
}

// Only pay for pub/sub fan-out when more than one node is alive.
let multiNode = false;
setInterval(() => {
  liveNodes().then(
    (n) => (multiNode = n > 1),
    () => {}, // keep the last answer if redis hiccups
  );
}, 5000).unref();

await sub.subscribe(DELIVER, nodeChannel(NODE_ID));
sub.on("message", (channel, raw) => {
  const data = JSON.parse(raw);
  if (channel === DELIVER) {
    if (data.from === NODE_ID) return;
    const json = JSON.stringify(data.msg);
    for (const id of data.ids as string[]) {
      const c = conns.get(id);
      if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(json);
    }
  } else {
    const f = data as Forwarded;
    remoteRtt.set(f.from, f.rtt);
    onForward(f);
  }
});
