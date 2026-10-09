// Realtime connection + all live game state. Pages render from this store;
// the server is authoritative for everything except local typing feedback.
import type {
  ClientMsg,
  LivePlayer,
  Mode,
  PlayerPublic,
  QueueMode,
  RaceResultRow,
  RaceStart,
  RoomPublic,
  ServerMsg,
} from "@mtr/race-protocol";
import { api } from "./api";
import { notifier } from "./notify.svelte";
import { toasts } from "./toast.svelte";

type QueueStatus = Extract<ServerMsg, { type: "queue.status" }>;
export type MatchFound = { matchId: string; mode: Mode; players: PlayerPublic[]; readyBy: number; ready: string[] };
export type RaceResult = Omit<Extract<ServerMsg, { type: "race.result" }>, "type">;
export type Rematch = { matchId: string; expiresAt: number; requested: string[]; closed: string | null };
export type ActiveRace = RaceStart & { resumeKeys: { k: string; t: number }[] | null };

class Game {
  status = $state<"offline" | "connecting" | "online">("offline");
  /** the connection actually failed or dropped (not just a deliberate reconnect) */
  down = $state(false);
  you = $state<PlayerPublic | null>(null);
  rankedOk = $state(false);
  queue = $state<QueueStatus | null>(null);
  /** queue we're in (kept through ready checks so we can show "re-queued") */
  queueMode = $state<QueueMode | null>(null);
  match = $state<MatchFound | null>(null);
  /** last ready check that fell through; `requeued` false means we were dropped from the queue */
  cancelled = $state<{ requeued: boolean; at: number } | null>(null);
  race = $state<ActiveRace | null>(null);
  live = $state<Record<string, LivePlayer>>({});
  result = $state<RaceResult | null>(null);
  room = $state<RoomPublic | null>(null);
  /** the server confirmed our room on the current connection (cleared when it drops) */
  roomLive = $state(false);
  /** open casual rematch offer for the last result */
  rematch = $state<Rematch | null>(null);
  lastError = $state<{ code: string; message: string; at: number } | null>(null);
  rtt = $state(0);

  /** server clock minus local clock, in ms */
  offset = 0;
  private bestRtt = Infinity;
  private ws: WebSocket | null = null;
  private wanted = false;
  private retry = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pending: ClientMsg[] = [];
  private guestName: string | undefined;
  private connecting: Promise<void> | null = null;

  serverNow() {
    return Date.now() + this.offset;
  }

  /** Connect if needed; resolves once the socket is open. */
  connect(): Promise<void> {
    this.wanted = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    this.connecting ??= this.open().finally(() => (this.connecting = null));
    return this.connecting;
  }

  /** Reconnect with a new identity (after sign-in/out or a guest rename). */
  async reconnect(guestName?: string) {
    this.guestName = guestName;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.status = "offline";
    this.roomLive = false;
    if (this.wanted) await this.connect();
  }

  private async open() {
    this.status = "connecting";
    const r = await api.auth.ticket({ body: { guestName: this.guestName } }).catch(() => null);
    if (r?.status !== 200) {
      this.status = "offline";
      this.down = true;
      this.scheduleReconnect();
      throw new Error("Couldn't reach the server.");
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?ticket=${encodeURIComponent(r.body.ticket)}`);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this.status = "online";
        this.down = false;
        this.retry = 0;
        this.bestRtt = Infinity;
        for (const m of this.pending.splice(0)) ws.send(JSON.stringify(m));
        this.syncClock();
        resolve();
      };
      ws.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMsg);
      ws.onclose = (e) => {
        if (this.ws !== ws) return;
        this.status = "offline";
        this.down = true;
        this.roomLive = false;
        this.ws = null;
        clearInterval(this.pingTimer);
        if (e.code === 4000) {
          toasts.show("You opened MT Ranked in another tab, so this one disconnected.", "error", 8000);
          this.wanted = false;
        } else if (this.wanted) this.scheduleReconnect();
        reject(new Error("closed"));
      };
    });
  }

  private scheduleReconnect() {
    if (!this.wanted) return;
    const delay = Math.min(5000, 300 * 2 ** this.retry++);
    setTimeout(() => {
      if (this.wanted && !this.ws) this.connect().catch(() => {});
    }, delay);
  }

  private syncClock() {
    clearInterval(this.pingTimer);
    let burst = 0;
    const ping = () => this.send({ type: "ping", t: Date.now() });
    ping();
    const fast = setInterval(() => {
      ping();
      if (++burst >= 4) clearInterval(fast);
    }, 150);
    this.pingTimer = setInterval(ping, 4000);
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.type !== "input.batch" && msg.type !== "ping") {
      this.pending.push(msg);
      this.connect().catch(() => {});
    }
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.type) {
      case "hello":
        this.you = msg.you;
        this.rankedOk = msg.rankedOk;
        this.offset = msg.serverTime - Date.now();
        break;
      case "pong": {
        const now = Date.now();
        const rtt = now - msg.t;
        this.rtt = rtt;
        // keep the estimate from the fastest round trip seen
        if (rtt <= this.bestRtt * 1.2) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = msg.serverTime - (msg.t + rtt / 2);
        }
        break;
      }
      case "error":
        this.lastError = { code: msg.code, message: msg.message, at: Date.now() };
        // queue refusals are shown in place by the play page
        if (msg.code !== "queue_timeout" && msg.code !== "ranked_blocked") toasts.show(msg.message, "error", 6000);
        break;
      case "notice":
        toasts.show(msg.message, "error", 10_000);
        break;
      case "queue.status":
        this.queue = msg;
        this.queueMode = msg.mode;
        break;
      case "queue.left":
        this.queue = null;
        this.queueMode = null;
        if (msg.reason) toasts.show(msg.reason);
        break;
      case "match.found":
        this.match = { matchId: msg.matchId, mode: msg.mode, players: msg.players, readyBy: msg.readyBy, ready: [] };
        this.queue = null;
        // a ghost race in progress is dropped for the real match
        if (this.race?.mode === "ghost") this.race = null;
        if (this.result?.mode === "ghost") this.result = null;
        notifier.matchFound(msg.mode);
        break;
      case "match.ready":
        if (this.match?.matchId === msg.matchId) this.match.ready = msg.ready;
        break;
      case "match.cancelled":
        this.match = null;
        notifier.clear();
        this.cancelled = { requeued: msg.requeued, at: Date.now() };
        if (msg.requeued) toasts.show(`${msg.reason} Back in the queue.`);
        else toasts.show(msg.reason, "error", 10_000);
        if (!msg.requeued) this.queueMode = null;
        break;
      case "room.state":
        this.room = msg.room;
        this.roomLive = true;
        break;
      case "room.closed":
        this.room = null;
        this.roomLive = false;
        if (this.race && this.race.mode === "private") this.race = null;
        toasts.show(msg.reason, "info", 6000);
        break;
      case "race.countdown":
      case "race.resume":
        this.match = null;
        notifier.clear();
        this.result = null;
        this.rematch = null;
        this.live = {};
        this.race = { ...msg, resumeKeys: msg.type === "race.resume" ? msg.keys : null };
        break;
      case "race.state":
        if (this.race?.raceId === msg.raceId) {
          const live: Record<string, LivePlayer> = {};
          for (const p of msg.players) live[p.id] = p;
          this.live = live;
        }
        break;
      case "race.result":
        this.result = msg;
        this.rematch = msg.rematch ? { matchId: msg.matchId, expiresAt: msg.rematch.expiresAt, requested: [], closed: null } : null;
        if (msg.mode !== "ghost" && msg.mode !== "private") this.queueMode = null;
        break;
      case "rematch.status":
        if (this.rematch?.matchId === msg.matchId) {
          this.rematch.requested = msg.requested;
          if (msg.closed) this.rematch.closed = msg.closed;
        }
        break;
    }
  }

  // ------------------------------------------------------------ actions
  joinQueue(mode: QueueMode) {
    this.dropRematch();
    this.result = null;
    this.race = null;
    this.queueMode = mode;
    this.send({ type: "queue.join", mode });
  }
  leaveQueue() {
    this.queueMode = null;
    this.queue = null;
    this.send({ type: "queue.leave" });
  }
  leaveRace() {
    this.send({ type: "race.leave" });
    this.race = null;
  }
  requestRematch() {
    if (this.rematch && !this.rematch.closed) this.send({ type: "rematch.request", matchId: this.rematch.matchId });
  }
  /** Let the opponent know we're not waiting around for a rematch. */
  private dropRematch() {
    const r = this.rematch;
    this.rematch = null;
    if (r && !r.closed && this.serverNow() < r.expiresAt) this.send({ type: "rematch.decline", matchId: r.matchId });
  }
  clearRace() {
    this.dropRematch();
    this.race = null;
    this.result = null;
    this.live = {};
  }
}

export const game = new Game();
