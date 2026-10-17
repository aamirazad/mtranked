import * as Sentry from "@sentry/node";
import { reportError } from "./sentry";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { getUser, suspension } from "@mtr/db";
import { DEFAULT_ROOM_SETTINGS, parseClientMsg, type ClientMsg, type PlayerPublic } from "@mtr/race-protocol";
import { env } from "./env";
import { NODE_ID, nodeAlive, redis, sub } from "./redis";
import { Conn, conns, forward, sendTo, setForwardHandler, type Forwarded, type RoomGone } from "./hub";
import { checkSharedIp, currentRating, publicInfo, rankedBlock, redeemTicket, type Identity } from "./players";
import { Room, roomByCode, roomOf, rooms, type Member } from "./room";
import {
  dequeue,
  enqueue,
  markDisconnected,
  markReconnected,
  queueBanLeft,
  queueMeta,
  resumeQueue,
  startGhostRace,
  stopMatcher,
} from "./matchmaker";
import { declineRematch, requestRematch } from "./rematch";
import { friendsOf, presenceOf, sendFriendsSnapshot, setOffline, setOnline } from "./friends";

const err = (id: string, code: string, message: string) => sendTo(id, { type: "error", code, message });

/** Set on SIGTERM/SIGINT: races in progress finish, nothing new starts. */
let draining = false;
/** Set once we start closing every socket on the way out. */
let exiting = false;
const RESTARTING = "The server is restarting for an update. Try again in a moment.";
/** Message types that would start something new; refused while draining. */
const STARTS = new Set<ClientMsg["type"]>(["queue.join", "ghost.accept", "rematch.request", "room.create", "room.join", "room.start"]);

const LEFT_FOR_ROOM = "You left the matchmaking queue to join a private room.";

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
      | "room.promote"
      | "room.demote"
      | "room.lock"
      | "room.close"
      | "room.rename"
      | "room.theme"
      | "room.hurry"
      | "room.invite"
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
      if (room.mode === "private") return room.removeMember(id, null);
      // matchmade players decline a ready check instead; mid-race it's a forfeit
      if (room.status === "countdown" || room.status === "racing") room.forfeit(id);
      return;
    case "room.settings":
      return room.onSettings(id, msg.settings);
    case "room.start":
      // forwarded from another node, which doesn't know we're draining
      if (draining) return err(id, "restarting", RESTARTING);
      return void room.onStart(id, msg.sameText);
    case "room.kick":
      return room.onKick(id, msg.playerId);
    case "room.promote":
      return room.onPromote(id, msg.playerId);
    case "room.demote":
      return room.onDemote(id, msg.playerId);
    case "room.lock":
      return room.onLock(id, msg.locked);
    case "room.close":
      return room.onClose(id);
    case "room.rename":
      return room.onRename(id, msg.name);
    case "room.theme":
      return room.onTheme(id, msg.theme);
    case "room.hurry":
      return room.onHurry(id);
    case "room.invite":
      return void room.onInvite(id, msg.playerIds);
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
    if (draining) return err(f.from, "restarting", RESTARTING);
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

/** A new room: offer to invite every friend who's around (anyone not in a ranked or casual match). */
async function suggestFriends(conn: Conn, room: Room, skip: string[]) {
  if (conn.idn.guest || !room.code) return;
  const ids = (await friendsOf(conn.id)).filter((f) => !skip.includes(f));
  const presence = await presenceOf(ids);
  const around = ids.filter((f) => presence[f]!.online && presence[f]!.activity?.kind !== "match");
  if (around.length) conn.send({ type: "room.suggest", code: room.code, friends: around });
}

async function handle(conn: Conn, msg: ClientMsg) {
  const id = conn.id;
  if (draining && STARTS.has(msg.type)) return err(id, "restarting", RESTARTING);
  switch (msg.type) {
    case "ping":
      return conn.send({ type: "pong", t: msg.t, serverTime: Date.now() });

    case "queue.join": {
      const current = roomOf(id);
      if (current && current.mode !== "ghost") return err(id, "busy", "Finish or leave your current room first.");
      if (!conn.idn.guest) {
        conn.idn.user = (await getUser(id)) ?? conn.idn.user;
        const suspended = conn.idn.user && suspension(conn.idn.user);
        if (suspended) {
          await dequeue(id);
          return err(id, "suspended", suspended);
        }
      }
      if (await resumeQueue(id, msg.mode)) return;
      // decline lockouts only apply to ranked
      const ban = msg.mode === "ranked" ? await queueBanLeft(id) : 0;
      if (ban > 0) return err(id, "queue_timeout", `You declined too many matches. Queue opens again in ${Math.ceil(ban / 60)} min.`);
      if (await queueMeta(id)) await dequeue(id);
      const flagged = conn.idn.user?.flagged_at != null;
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
      await dequeue(id, LEFT_FOR_ROOM);
      conn.info = await publicInfo(conn.idn);
      const room = Room.createPrivate(member(conn.idn, conn.info), { ...DEFAULT_ROOM_SETTINGS, ...msg.settings });
      if (msg.invite?.length) await room.onInvite(id, msg.invite);
      await suggestFriends(conn, room, msg.invite ?? []);
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
      await dequeue(id, LEFT_FOR_ROOM);
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
      if (!node || !(await nodeAlive(node))) {
        const closed = await redis.get(`roomclosed:${code}`);
        if (closed) return err(id, "room_closed", closed);
        return err(id, "room_join", "No room with that code. Check it and try again.");
      }
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

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 32 * 1024,
  // while draining only players with a room here (resuming a race) get in; the
  // rest get a 503 and the client retries until the new process is up
  verifyClient: (info, done) => {
    if (!draining) return done(true);
    const ticket = new URL(info.req.url ?? "", "http://x").searchParams.get("ticket") ?? "";
    if (!/^[\w-]{20,64}$/.test(ticket)) return done(false, 503, "restarting");
    redis.get(`ticket:${ticket}`).then(
      (raw) => {
        const t = raw ? (JSON.parse(raw) as { kind: string; id?: string; userId?: string }) : null;
        const pid = t?.kind === "guest" ? t.id : t?.userId;
        done(!!pid && !!roomOf(pid), 503, "restarting");
      },
      () => done(false, 503, "restarting"),
    );
  },
});
wss.on("error", (e) => reportError("[ws] server error", e));

// fire-and-forget redis writes and async handlers must never take the node down
// (sentry.ts reports these to Sentry too)
process.on("unhandledRejection", (e) => console.error("[realtime] unhandled rejection", e));

const EARLY_MAX = 20;

/** Token bucket: up to `burst` at once, refilling `rate` per second. */
function bucket(burst: number, rate: number) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

/** Messages that hit the DB or redis get a much tighter budget. */
const EXPENSIVE = new Set<ClientMsg["type"]>(["room.create", "room.join", "queue.join", "ghost.accept", "rematch.request"]);

wss.on("connection", async (ws, req) => {
  // oversized/invalid frames emit 'error'; unhandled it would crash the process (ws closes the socket itself)
  ws.on("error", (e) => console.warn("[ws] socket error", e.message));
  // buffer anything the client sends while we authenticate
  const early: string[] = [];
  const buffer = (d: unknown) => {
    if (early.length >= EARLY_MAX) return ws.close(4008, "too many messages");
    early.push(String(d));
  };
  ws.on("message", buffer);
  const url = new URL(req.url ?? "", "http://x");
  const idn = await redeemTicket(url.searchParams.get("ticket") ?? "");
  if (!idn) return ws.close(4001, "unauthorized");
  const info = await publicInfo(idn);
  // gone while we were authenticating (or closed for flooding)
  if (ws.readyState !== ws.OPEN) return;
  const conn = new Conn(ws, idn, info);

  const old = conns.get(idn.id);
  if (old) {
    old.ws.close(4000, "replaced");
  }
  conns.set(idn.id, conn);
  // attach before any await, or a socket that closes meanwhile stays in conns forever
  ws.on("close", async () => {
    // on the way out: redis is closing and the player reconnects to the next process
    if (exiting || conns.get(idn.id) !== conn) return;
    conns.delete(idn.id);
    setOffline(idn.id);
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
  // closed or replaced mid-resume: stop, so we don't mark a dead socket reconnected after its close ran
  const stale = () => conns.get(idn.id) !== conn;

  const rankedOk = !(await rankedBlock(idn));
  if (stale()) return;
  conn.send({ type: "hello", you: info, serverTime: Date.now(), verified: !!idn.user?.email_verified_at, rankedOk });
  setOnline(idn.id);
  void sendFriendsSnapshot(conn).catch((e) => reportError("[friends] snapshot failed", e));

  // resume whatever this player was doing
  const local = roomOf(idn.id);
  let inRoom = !!local;
  if (local) local.reconnect(idn.id);
  else {
    const roomId = await redis.get(`proom:${idn.id}`);
    if (roomId) {
      const raw = await redis.get(`room:${roomId}`);
      const node = raw ? (JSON.parse(raw).node as string) : null;
      if (node && node !== NODE_ID && (await nodeAlive(node))) {
        if (stale()) return;
        inRoom = true;
        await forward(node, { from: idn.id, rtt: conn.rtt(), msg: { type: "_rc" } });
      } else {
        await redis.del(`proom:${idn.id}`);
        if (raw) conn.send({ type: "room.closed", reason: "The race server restarted, so that match was voided (no rating change)." });
      }
    }
  }
  if (stale()) return;
  // lost a private room while offline (closed, or dropped for being away): say why
  const gone = await redis.getdel(`roomgone:${idn.id}`);
  if (gone && !inRoom) conn.send({ type: "room.closed", ...(JSON.parse(gone) as RoomGone) });
  // tell the client it isn't queued, so a tab that lost its place doesn't keep showing a search
  if (!(await markReconnected(idn.id)) && !inRoom) conn.send({ type: "queue.left" });
  const notice = await redis.getdel(`notice:${idn.id}`);
  if (notice) conn.send({ type: "notice", message: notice });

  let queue = Promise.resolve();
  // clients send an input batch every 100ms plus the odd ping/action
  const allow = bucket(40, 20);
  const allowExpensive = bucket(5, 0.5);
  let dropped = 0;
  let dropSince = 0;
  const onMessage = (data: unknown) => {
    if (!allow()) {
      const now = Date.now();
      if (now - dropSince > 10_000) {
        dropSince = now;
        dropped = 0;
      }
      // still flooding after hundreds of drops: cut them off
      if (++dropped > 200) ws.close(4008, "rate limited");
      return;
    }
    const msg = parseClientMsg(String(data));
    if (!msg) return;
    if (EXPENSIVE.has(msg.type) && !allowExpensive())
      return conn.send({ type: "error", code: "slow_down", message: "You're doing that too fast." });
    // keep per-connection ordering (inputs must be applied in sequence)
    queue = queue.then(() => handle(conn, msg)).catch((e) => reportError("[ws] handler error", e));
  };
  ws.off("message", buffer);
  ws.on("message", onMessage);
  for (const d of early) onMessage(d);

  ws.on("pong", () => {
    conn.alive = true;
    conn.rtts.push(Date.now() - conn.pingSentAt);
    if (conn.rtts.length > 7) conn.rtts.shift();
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

// ------------------------------------------------------------------ graceful shutdown
// Deploys restart this process. Rooms live in memory, so let ready checks and
// races in progress finish (up to DRAIN_MAX_MS) before going away.
const DRAIN_MAX_MS = 150_000;
const RESTARTED = "The server restarted for an update. Create a new room to keep playing.";
/** standard "service restart" close code; the client reconnects (only 4000 stops it) */
const SERVICE_RESTART = 1012;

async function drain(signal: string) {
  if (draining) {
    console.log(`[shutdown] ${signal} again, exiting now`);
    process.exit(1);
  }
  draining = true;
  const started = Date.now();
  console.log(`[shutdown] ${signal}: draining (up to ${DRAIN_MAX_MS / 1000}s)`);
  try {
    await stopMatcher();
  } catch (e) {
    reportError("[shutdown] failed to stop the matcher", e);
  }
  let lastLog = 0;
  for (;;) {
    const active = [...rooms.values()].filter((r) => r.active).length;
    if (!active) break;
    const now = Date.now();
    if (now - started >= DRAIN_MAX_MS) {
      console.warn(`[shutdown] gave up waiting on ${active} active room(s)`);
      break;
    }
    if (now - lastLog >= 10_000) {
      lastLog = now;
      console.log(`[shutdown] waiting on ${active} active room(s), ${Math.round((now - started) / 1000)}s in`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`[shutdown] drained in ${Math.round((Date.now() - started) / 1000)}s, closing ${conns.size} socket(s)`);
  // private rooms can't survive the restart; matchmade ones left over (cut off
  // by the cap) are reported as voided when their players reconnect
  for (const room of [...rooms.values()]) if (room.mode === "private") room.close(RESTARTED);
  exiting = true;
  server.close();
  for (const ws of wss.clients) ws.close(SERVICE_RESTART, "restarting");
  try {
    // quit waits for queued commands (room cleanup above) to go out first
    await Promise.all([redis.quit(), sub.quit()]);
  } catch (e) {
    console.error("[shutdown] redis quit failed", e);
  }
  await Sentry.flush(2000);
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void drain(signal));
