// The Hub: the one Durable Object behind /ws. It holds every player's socket, the matchmaking
// queue, every room and race, and friends presence, all in memory (this replaces the Node
// realtime server and Redis). Sockets use the hibernation API: while nothing is going on the
// Hub sleeps and costs nothing, idle keepalives are answered without waking it, and its 100 ms
// timer only runs while there is a queue, a room or a rematch offer to look after.
import { DurableObject } from "cloudflare:workers";
import { DEFAULT_ROOM_SETTINGS, KEEPALIVE, parseClientMsg, type ClientMsg, type PlayerPublic } from "@mtr/race-protocol";
import { redeemTicket } from "../auth";
import { getUser, suspension } from "../db";
import { reportError } from "../sentry";
import { conns, Conn, initStore, noticeLostRooms, sendTo, store, type Attachment } from "./core";
import { friendsChanged, friendsOf, friendsWith, presenceOf, pushPresence, sendFriendsSnapshot, setQueuedModeLookup } from "./friends";
import {
  dequeue,
  enqueue,
  markDisconnected,
  markReconnected,
  queueBanLeft,
  queuedMode,
  queueMeta,
  queueSize,
  resumeQueue,
  runMatcher,
  startGhostRace,
} from "./matchmaker";
import { checkSharedIp, currentRating, publicInfo, rankedBlock, type Identity } from "./players";
import { declineRematch, openOffers, requestRematch } from "./rematch";
import { Room, roomByCode, roomOf, rooms, setRoomOpenHook, spectating, tickRooms, type JoinRequest, type Member, type Spectator } from "./room";

const err = (id: string, code: string, message: string) => sendTo(id, { type: "error", code, message });

const LEFT_FOR_ROOM = "You left the matchmaking queue to join a private room.";
const NOT_IN_ROOM = "They're not in a private room right now.";
const NOTHING_TO_WATCH = "They're not racing or in a room right now.";
const MAX_MESSAGE = 32 * 1024;
const TICK_MS = 100;
/** a socket that sent nothing, not even a keepalive, for this long is treated as gone */
const SILENT_MS = 150_000;

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
      | "room.answer"
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
    case "room.answer":
      return room.onAnswer(id, msg.playerId, msg.accept);
  }
}

/** Messages that hit the database get a much tighter budget. */
const EXPENSIVE = new Set<ClientMsg["type"]>([
  "room.create",
  "room.join",
  "queue.join",
  "ghost.accept",
  "rematch.request",
  "room.request",
  "room.invite",
  "spectate.start",
]);

/** Stop watching whatever this player watches. */
function stopSpectating(id: string) {
  const roomId = spectating.get(id);
  if (roomId) rooms.get(roomId)?.removeSpectator(id, false);
}

/** A new room: offer to invite every friend who's around (anyone not in a ranked or casual match). */
async function suggestFriends(conn: Conn, room: Room, skip: string[]) {
  if (conn.idn.guest || !room.code) return;
  const ids = (await friendsOf(conn.id)).filter((f) => !skip.includes(f));
  const presence = presenceOf(ids);
  const around = ids.filter((f) => presence[f]!.online && presence[f]!.activity?.kind !== "match");
  if (around.length) conn.send({ type: "room.suggest", code: room.code, friends: around });
}

export class Hub extends DurableObject<Env> {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticks = 0;
  private byWs = new WeakMap<WebSocket, Conn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initStore(ctx.storage);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE, KEEPALIVE));
    // back from hibernation (or a restart): sockets survive, everything else starts empty
    conns.clear();
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) {
        ws.close(1011, "lost");
        continue;
      }
      const c = new Conn(ws, { ...a.idn }, a.info);
      conns.set(c.id, c);
      this.byWs.set(ws, c);
    }
    // a restart (deploy) ended any rooms that were open: tell their players when they're back
    if (!rooms.size) noticeLostRooms();
    setRoomOpenHook(() => this.wake());
    setQueuedModeLookup(queuedMode);
  }

  // ---------------------------------------------------------------- timer
  /** Something needs looking after: run the tick until it's all gone. */
  private wake() {
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
  }

  private busy(now: number) {
    return rooms.size > 0 || queueSize() > 0 || openOffers(now) > 0;
  }

  private tick() {
    const now = Date.now();
    this.ticks++;
    try {
      tickRooms(now);
      if (this.ticks % 10 === 0 && queueSize()) runMatcher(now);
      if (this.ticks % 100 === 0) this.sweep(now);
    } catch (e) {
      reportError("[hub] tick failed", e);
    }
    if (!this.busy(now)) {
      // nothing left: stop, so the Hub can hibernate
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Drop sockets that went silent without closing (the edge doesn't always notice). */
  private sweep(now: number) {
    for (const c of [...conns.values()]) {
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(c.ws)?.getTime() ?? 0;
      if (now - Math.max(c.lastMsgAt, auto) < SILENT_MS) continue;
      try {
        c.ws.close(4002, "timeout");
      } catch {
        // already closed
      }
      this.gone(c);
    }
    store.sweep();
  }

  // ---------------------------------------------------------------- RPC from the API
  /** A friendship changed: refresh both players' lists and presence. */
  friendsChanged(ids: string[]) {
    friendsChanged(ids);
  }

  // ---------------------------------------------------------------- sockets
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const t = await redeemTicket(new URL(request.url).searchParams.get("ticket"));
    let idn: Identity | null = null;
    if (t?.kind === "guest") idn = { id: t.id, guest: true, name: t.name };
    else if (t?.kind === "user") {
      const user = await getUser(t.userId);
      if (user && !user.banned_at) idn = { id: user.id, guest: false, name: user.display_name, user };
    }
    if (!idn) {
      server.accept();
      server.close(4001, "unauthorized");
      return new Response(null, { status: 101, webSocket: client });
    }
    const info = await publicInfo(idn);
    const rankedOk = !(await rankedBlock(idn, false));

    this.ctx.acceptWebSocket(server);
    const conn = new Conn(server, idn, info);
    conn.persist();
    this.byWs.set(server, conn);
    const old = conns.get(idn.id);
    conns.set(idn.id, conn);
    // one tab per identity: the older one is told why and stops reconnecting
    if (old) {
      try {
        old.ws.close(4000, "replaced");
      } catch {
        // already closed
      }
    }
    this.connected(conn, rankedOk);
    return new Response(null, { status: 101, webSocket: client });
  }

  private connected(conn: Conn, rankedOk: boolean) {
    const id = conn.id;
    conn.send({ type: "hello", you: conn.info, serverTime: Date.now(), verified: !!conn.idn.user?.email_verified_at, rankedOk });
    pushPresence(id);
    void sendFriendsSnapshot(conn).catch((e) => reportError("[friends] snapshot failed", e));

    // resume whatever this player was doing
    const room = roomOf(id);
    if (room) room.reconnect(id);
    // lost a room while offline (closed, dropped for being away, or ended by a restart): say why
    const gone = store.take(`roomgone:${id}`);
    if (gone && !room) conn.send({ type: "room.closed", ...JSON.parse(gone) });
    // tell the client it isn't queued, so a tab that lost its place doesn't keep showing a search
    if (!markReconnected(id) && !room) conn.send({ type: "queue.left" });
    const notice = store.take(`notice:${id}`);
    if (notice) conn.send({ type: "notice", message: notice });
  }

  private connOf(ws: WebSocket): Conn | undefined {
    const c = this.byWs.get(ws);
    if (c) return c;
    const a = ws.deserializeAttachment() as Attachment | null;
    const found = a ? conns.get(a.idn.id) : undefined;
    if (found?.ws === ws) {
      this.byWs.set(ws, found);
      return found;
    }
    return undefined;
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const conn = this.connOf(ws);
    if (!conn || conns.get(conn.id) !== conn) {
      try {
        ws.close(4000, "replaced");
      } catch {
        // already closed
      }
      return;
    }
    conn.lastMsgAt = Date.now();
    const raw = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (raw.length > MAX_MESSAGE) return ws.close(1009, "too big");
    if (!conn.allow()) {
      const now = Date.now();
      if (now - conn.dropSince > 10_000) {
        conn.dropSince = now;
        conn.dropped = 0;
      }
      // still flooding after hundreds of drops: cut them off
      if (++conn.dropped > 200) ws.close(4008, "rate limited");
      return;
    }
    const msg = parseClientMsg(raw);
    if (!msg) return;
    if (EXPENSIVE.has(msg.type) && !conn.allowExpensive()) {
      return conn.send({ type: "error", code: "slow_down", message: "You're doing that too fast." });
    }
    conn.queue = conn.queue.then(() => this.handle(conn, msg)).catch((e) => reportError("[ws] handler error", e));
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    const conn = this.connOf(ws);
    if (conn) this.gone(conn);
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  webSocketError(ws: WebSocket) {
    const conn = this.connOf(ws);
    if (conn) this.gone(conn);
  }

  /** A socket closed (or went silent): the player is offline until they reconnect. */
  private gone(conn: Conn) {
    const id = conn.id;
    // replaced by a newer tab: nothing changes for the player
    if (conns.get(id) !== conn) return;
    conns.delete(id);
    pushPresence(id);
    stopSpectating(id);
    roomOf(id)?.disconnect(id);
    markDisconnected(id);
  }

  // ---------------------------------------------------------------- messages
  private async handle(conn: Conn, msg: ClientMsg) {
    const id = conn.id;
    switch (msg.type) {
      case "ping":
        if (msg.rtt !== undefined) {
          conn.rtts.push(msg.rtt);
          if (conn.rtts.length > 7) conn.rtts.shift();
        }
        return conn.send({ type: "pong", t: msg.t, serverTime: Date.now() });

      case "queue.join": {
        const current = roomOf(id);
        if (current && current.mode !== "ghost") return err(id, "busy", "Finish or leave your current room first.");
        if (!conn.idn.guest) {
          conn.idn.user = (await getUser(id)) ?? conn.idn.user;
          const suspended = conn.idn.user && suspension(conn.idn.user);
          if (suspended) {
            dequeue(id);
            return err(id, "suspended", suspended);
          }
        }
        if (resumeQueue(id, msg.mode)) return;
        // decline lockouts only apply to ranked
        const ban = msg.mode === "ranked" ? queueBanLeft(id) : 0;
        if (ban > 0) return err(id, "queue_timeout", `You declined too many matches. Queue opens again in ${Math.ceil(ban / 60)} min.`);
        if (queueMeta(id)) dequeue(id);
        const flagged = conn.idn.user?.flagged_at != null;
        if (msg.mode === "ranked") {
          const block = await rankedBlock(conn.idn, false);
          if (block) return err(id, "ranked_blocked", block);
          this.ctx.waitUntil(checkSharedIp(id).catch((e) => reportError("[players] shared ip check failed", e)));
        }
        conn.info = await publicInfo(conn.idn);
        conn.persist();
        const rating = conn.idn.guest ? null : await currentRating(id);
        // left or got replaced while we looked things up
        if (conns.get(id) !== conn || roomOf(id)?.mode === "private") return;
        enqueue(conn.idn, conn.info, msg.mode, rating, flagged);
        this.wake();
        return;
      }

      case "queue.leave":
        dequeue(id);
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
        dequeue(id, LEFT_FOR_ROOM);
        conn.info = await publicInfo(conn.idn);
        conn.persist();
        if (roomOf(id)) return;
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
        dequeue(id, LEFT_FOR_ROOM);
        conn.info = await publicInfo(conn.idn);
        conn.persist();
        const roomId = roomByCode.get(code);
        const target = roomId ? rooms.get(roomId) : undefined;
        if (!target) {
          const closed = store.get(`roomclosed:${code}`);
          if (closed) return err(id, "room_closed", closed);
          return err(id, "room_join", "No room with that code. Check it and try again.");
        }
        const problem = target.join(member(conn.idn, conn.info));
        if (problem) err(id, "room_join", problem);
        return;
      }

      case "spectate.start": {
        if (conn.idn.guest) return err(id, "spectate", "Sign in to watch your friends.");
        if (!(await friendsWith(id, [msg.playerId])).size) return err(id, "spectate", "You can only watch friends.");
        stopSpectating(id);
        const room = roomOf(msg.playerId);
        if (!room) return err(id, "spectate", NOTHING_TO_WATCH);
        const spec: Spectator = { id, name: conn.info.name, via: msg.playerId };
        return room.addSpectator(spec);
      }

      case "spectate.stop":
        return stopSpectating(id);

      case "room.request": {
        if (conn.idn.guest) return err(id, "room_request", "Sign in to ask friends to let you in.");
        if (!(await friendsWith(id, [msg.playerId])).size) return err(id, "room_request", "You can only ask to join a friend's room.");
        const room = roomOf(msg.playerId);
        if (!room) return err(id, "room_request", NOT_IN_ROOM);
        const req: JoinRequest = { id, name: conn.info.name, level: conn.info.level, via: msg.playerId };
        return room.onJoinRequest(req);
      }

      default: {
        const room = roomOf(id);
        if (room) applyRoomMsg(room, id, msg);
      }
    }
  }
}
