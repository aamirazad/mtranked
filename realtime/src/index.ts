import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { getUser } from "@mtr/db";
import { DEFAULT_ROOM_SETTINGS, parseClientMsg, type ClientMsg, type PlayerPublic } from "@mtr/race-protocol";
import { env } from "./env";
import { NODE_ID, nodeAlive, redis } from "./redis";
import { Conn, conns, forward, sendTo, setForwardHandler, type Forwarded } from "./hub";
import { checkSharedIp, currentRating, publicInfo, rankedBlock, redeemTicket, type Identity } from "./players";
import { Room, roomByCode, roomOf, rooms, type Member } from "./room";
import {
  dequeue,
  enqueue,
  markDisconnected,
  markReconnected,
  queueBanLeft,
  queueMeta,
  startGhostRace,
} from "./matchmaker";
import { declineRematch, requestRematch } from "./rematch";

const err = (id: string, code: string, message: string) => sendTo(id, { type: "error", code, message });

const member = (idn: Identity, info: PlayerPublic): Member => ({ idn, info, connected: true, dcAt: null, ready: false });

/** Messages that act on the player's current room. */
type RoomMsg = Extract<
  ClientMsg,
  {
    type:
      | "ready"
      | "decline"
      | "room.leave"
      | "room.settings"
      | "room.start"
      | "room.kick"
      | "room.transfer"
      | "room.lock"
      | "room.rename"
      | "room.theme"
      | "input.batch"
      | "race.leave";
  }
>;

function applyRoomMsg(room: Room, id: string, msg: RoomMsg) {
  switch (msg.type) {
    case "ready":
      return room.onReady(id, msg.matchId);
    case "decline":
      return room.onDecline(id, msg.matchId);
    case "input.batch":
      return room.onInput(id, msg.raceId, msg.seq, msg.keys);
    case "race.leave":
      room.forfeit(id);
      if (room.mode === "ghost") room.close();
      return;
    case "room.leave":
      return room.removeMember(id, null);
    case "room.settings":
      return room.onSettings(id, msg.settings);
    case "room.start":
      return void room.onStart(id, msg.sameText);
    case "room.kick":
      return room.onKick(id, msg.playerId);
    case "room.transfer":
      return room.onTransfer(id, msg.playerId);
    case "room.lock":
      return room.onLock(id, msg.locked);
    case "room.rename":
      return room.onRename(id, msg.name);
    case "room.theme":
      return room.onTheme(id, msg.theme);
  }
}

/** Run a room message locally, or forward it to the node that owns the room. */
async function routeRoomMsg(conn: Conn, msg: RoomMsg) {
  const local = roomOf(conn.id);
  if (local) return applyRoomMsg(local, conn.id, msg);
  const roomId = await redis.get(`proom:${conn.id}`);
  if (!roomId) return;
  const raw = await redis.get(`room:${roomId}`);
  const node = raw ? (JSON.parse(raw).node as string) : null;
  if (node && node !== NODE_ID) await forward(node, { from: conn.id, rtt: conn.rtt(), msg });
}

setForwardHandler((f: Forwarded) => {
  const room = roomOf(f.from);
  const msg = f.msg as { type: string; [k: string]: unknown };
  if (msg.type === "_join") {
    const roomId = roomByCode.get(msg.code as string);
    const target = roomId ? rooms.get(roomId) : undefined;
    const problem = target ? target.join(member(msg.idn as Identity, msg.info as PlayerPublic)) : "Room not found.";
    if (problem) err(f.from, "room_join", problem);
    return;
  }
  if (!room) return;
  if (msg.type === "_dc") return room.disconnect(f.from);
  if (msg.type === "_rc") return room.reconnect(f.from);
  applyRoomMsg(room, f.from, msg as RoomMsg);
});

async function handle(conn: Conn, msg: ClientMsg) {
  const id = conn.id;
  switch (msg.type) {
    case "ping":
      return conn.send({ type: "pong", t: msg.t, serverTime: Date.now() });

    case "queue.join": {
      const current = roomOf(id);
      if (current && current.mode !== "ghost") return err(id, "busy", "Finish or leave your current room first.");
      const ban = await queueBanLeft(id);
      if (ban > 0) return err(id, "queue_timeout", `You declined too many matches. Queue opens again in ${Math.ceil(ban / 60)} min.`);
      if (await queueMeta(id)) await dequeue(id);
      let flagged = false;
      if (!conn.idn.guest) {
        conn.idn.user = (await getUser(id)) ?? conn.idn.user;
        flagged = conn.idn.user?.flagged_at != null;
      }
      if (msg.mode === "ranked") {
        const block = await rankedBlock(conn.idn);
        if (block) return err(id, "ranked_blocked", block);
        void checkSharedIp(id);
      }
      conn.info = await publicInfo(conn.idn);
      const rating = conn.idn.guest ? null : await currentRating(id);
      await enqueue(conn.idn, conn.info, msg.mode, rating, flagged);
      return;
    }

    case "queue.leave":
      await dequeue(id);
      return;

    case "ghost.accept": {
      const problem = await startGhostRace(conn.idn, conn.info);
      if (problem) err(id, "ghost", problem);
      return;
    }

    case "rematch.request":
      return requestRematch(conn, msg.matchId);

    case "rematch.decline":
      return declineRematch(id, msg.matchId);

    case "room.create": {
      const current = roomOf(id);
      if (current) {
        if (current.mode === "private") current.removeMember(id, null);
        else if (current.mode === "ghost") current.close();
        else return err(id, "busy", "Finish your current match first.");
      }
      await dequeue(id);
      conn.info = await publicInfo(conn.idn);
      Room.createPrivate(member(conn.idn, conn.info), { ...DEFAULT_ROOM_SETTINGS, ...msg.settings });
      return;
    }

    case "room.join": {
      const code = msg.code.toUpperCase();
      const current = roomOf(id);
      if (current && current.code !== code) {
        if (current.mode === "private") current.removeMember(id, null);
        else if (current.mode === "ghost") current.close();
        else return err(id, "busy", "Finish your current match first.");
      }
      await dequeue(id);
      conn.info = await publicInfo(conn.idn);
      const localId = roomByCode.get(code);
      if (localId) {
        const problem = rooms.get(localId)!.join(member(conn.idn, conn.info));
        if (problem) err(id, "room_join", problem);
        return;
      }
      const roomId = await redis.get(`roomcode:${code}`);
      const raw = roomId ? await redis.get(`room:${roomId}`) : null;
      const node = raw ? (JSON.parse(raw).node as string) : null;
      if (!node || !(await nodeAlive(node))) return err(id, "room_join", "No room with that code. Check it and try again.");
      await forward(node, {
        from: id,
        rtt: conn.rtt(),
        msg: { type: "_join", code, idn: { id, guest: conn.idn.guest, name: conn.idn.name }, info: conn.info },
      });
      return;
    }

    default:
      return routeRoomMsg(conn, msg);
  }
}

// ------------------------------------------------------------------ server
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ ok: true, node: NODE_ID, players: conns.size, rooms: rooms.size }));
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 32 * 1024 });

wss.on("connection", async (ws, req) => {
  // buffer anything the client sends while we authenticate
  const early: string[] = [];
  const buffer = (d: unknown) => early.push(String(d));
  ws.on("message", buffer);
  const url = new URL(req.url ?? "", "http://x");
  const idn = await redeemTicket(url.searchParams.get("ticket") ?? "");
  if (!idn) return ws.close(4001, "unauthorized");
  const info = await publicInfo(idn);
  const conn = new Conn(ws, idn, info);

  const old = conns.get(idn.id);
  if (old) {
    old.ws.close(4000, "replaced");
  }
  conns.set(idn.id, conn);

  const rankedOk = !(await rankedBlock(idn));
  conn.send({ type: "hello", you: info, serverTime: Date.now(), verified: !!idn.user?.email_verified_at, rankedOk });

  // resume whatever this player was doing
  const local = roomOf(idn.id);
  if (local) local.reconnect(idn.id);
  else {
    const roomId = await redis.get(`proom:${idn.id}`);
    if (roomId) {
      const raw = await redis.get(`room:${roomId}`);
      const node = raw ? (JSON.parse(raw).node as string) : null;
      if (node && node !== NODE_ID && (await nodeAlive(node))) {
        await forward(node, { from: idn.id, rtt: conn.rtt(), msg: { type: "_rc" } });
      } else {
        await redis.del(`proom:${idn.id}`);
        if (raw) conn.send({ type: "room.closed", reason: "The race server restarted, so that match was voided (no rating change)." });
      }
    }
  }
  await markReconnected(idn.id);

  let queue = Promise.resolve();
  const onMessage = (data: unknown) => {
    const msg = parseClientMsg(String(data));
    if (!msg) return;
    // keep per-connection ordering (inputs must be applied in sequence)
    queue = queue.then(() => handle(conn, msg)).catch((e) => console.error("[ws] handler error", e));
  };
  ws.off("message", buffer);
  ws.on("message", onMessage);
  for (const d of early) onMessage(d);

  ws.on("pong", () => {
    conn.alive = true;
    conn.rtts.push(Date.now() - conn.pingSentAt);
    if (conn.rtts.length > 7) conn.rtts.shift();
  });

  ws.on("close", async () => {
    if (conns.get(idn.id) !== conn) return;
    conns.delete(idn.id);
    const room = roomOf(idn.id);
    if (room) room.disconnect(idn.id);
    else {
      const roomId = await redis.get(`proom:${idn.id}`);
      const raw = roomId ? await redis.get(`room:${roomId}`) : null;
      const node = raw ? (JSON.parse(raw).node as string) : null;
      if (node && node !== NODE_ID) await forward(node, { from: idn.id, rtt: 0, msg: { type: "_dc" } });
    }
    await markDisconnected(idn.id);
  });
});

// keepalive + RTT measurement
setInterval(() => {
  for (const c of conns.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.pingSentAt = Date.now();
    c.ws.ping();
  }
}, 2000).unref();

server.listen(env.port, () => console.log(`realtime node ${NODE_ID} listening on :${env.port}`));
