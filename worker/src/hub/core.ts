// The Hub's connection registry and its small durable store. Everything live (queue, rooms,
// presence) is in memory: there is exactly one Hub, so nothing has to be shared. The Hub stays
// awake while any of it exists (see hub/index.ts), and may hibernate only once it's all gone.
import type { PlayerPublic, ServerMsg } from "@mtr/race-protocol";
import type { Identity } from "./players";

/** What survives hibernation on each socket. */
export type Attachment = { idn: Pick<Identity, "id" | "guest" | "name">; info: PlayerPublic };

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

export class Conn {
  rtts: number[] = [];
  lastMsgAt = Date.now();
  // clients send an input batch every 100ms plus the odd ping/action
  allow = bucket(40, 20);
  /** messages that hit the database get a much tighter budget */
  allowExpensive = bucket(5, 0.5);
  dropped = 0;
  dropSince = 0;
  /** keeps per-connection ordering (inputs must be applied in sequence) */
  queue: Promise<void> = Promise.resolve();
  constructor(
    public ws: WebSocket,
    public idn: Identity,
    public info: PlayerPublic,
  ) {}
  get id() {
    return this.idn.id;
  }
  send(msg: ServerMsg) {
    sendRaw(this.ws, JSON.stringify(msg));
  }
  /** Median of the round trips the client reported, in ms. */
  rtt(): number {
    if (!this.rtts.length) return 100;
    const s = [...this.rtts].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
  /** Remember identity and public info on the socket itself, for after hibernation. */
  persist() {
    const a: Attachment = { idn: { id: this.idn.id, guest: this.idn.guest, name: this.idn.name }, info: this.info };
    try {
      this.ws.serializeAttachment(a);
    } catch {
      // closed already
    }
  }
}

function sendRaw(ws: WebSocket, data: string) {
  try {
    ws.send(data);
  } catch {
    // the socket closed under us; its close handler cleans up
  }
}

export const conns = new Map<string, Conn>();

export function deliver(ids: Iterable<string>, msg: ServerMsg) {
  let json: string | undefined;
  for (const id of ids) {
    const c = conns.get(id);
    if (!c) continue;
    json ??= JSON.stringify(msg);
    sendRaw(c.ws, json);
  }
}

export const sendTo = (id: string, msg: ServerMsg) => deliver([id], msg);
export const rttOf = (id: string) => conns.get(id)?.rtt() ?? 100;

// ------------------------------------------------------------------ durable store
// A tiny key/value table with expiry in the Hub's own SQLite storage, for the few things that
// must outlive a hibernation or restart: messages held for offline players and queue lockouts.
let sql: SqlStorage | undefined;

export function initStore(storage: DurableObjectStorage) {
  sql = storage.sql;
  sql.exec("create table if not exists held (k text primary key, v text not null, exp integer not null)");
  sql.exec("create table if not exists live_rooms (id text primary key, mode text not null, code text, members text not null)");
  sql.exec("delete from held where exp <= ?", Date.now());
}

export const store = {
  get(k: string): string | null {
    const row = sql!.exec<{ v: string }>("select v from held where k = ? and exp > ?", k, Date.now()).toArray()[0];
    return row?.v ?? null;
  },
  /** Remaining lifetime in ms (0 when missing). */
  ttl(k: string): number {
    const row = sql!.exec<{ exp: number }>("select exp from held where k = ? and exp > ?", k, Date.now()).toArray()[0];
    return row ? row.exp - Date.now() : 0;
  },
  set(k: string, v: string, ttlMs: number) {
    sql!.exec("insert or replace into held (k, v, exp) values (?, ?, ?)", k, v, Date.now() + ttlMs);
  },
  /** Set, keeping the expiry of an existing live value. */
  update(k: string, v: string, ttlMs: number) {
    const left = this.ttl(k);
    this.set(k, v, left || ttlMs);
  },
  del(k: string) {
    sql!.exec("delete from held where k = ?", k);
  },
  take(k: string): string | null {
    const v = this.get(k);
    if (v !== null) this.del(k);
    return v;
  },
  sweep() {
    sql!.exec("delete from held where exp <= ?", Date.now());
  },
};

/** Hold a message for a player who's offline; it's shown when they reconnect. */
export function holdNotice(id: string, message: string) {
  store.set(`notice:${id}`, message, 30 * 60_000);
}

/** Why an offline player lost their private room, held until they reconnect. */
export type RoomGone = { code?: string; reason: string; rejoin: boolean };
export function holdRoomGone(id: string, gone: RoomGone) {
  store.set(`roomgone:${id}`, JSON.stringify(gone), 3600_000);
}

// ------------------------------------------------------------------ rooms lost to a restart
// Each live room has a row (written when it opens or its players change, deleted when it
// closes). Rows still there when the Hub starts belong to rooms a restart (a deploy) ended.
export function recordRoom(id: string, mode: string, code: string | undefined, members: string[]) {
  sql!.exec("insert or replace into live_rooms (id, mode, code, members) values (?, ?, ?, ?)", id, mode, code ?? null, JSON.stringify(members));
}
export function forgetRoom(id: string) {
  sql!.exec("delete from live_rooms where id = ?", id);
}

const RESTART_MATCH = "The race server restarted, so that match was voided (no rating change).";
const RESTART_ROOM = "The server restarted for an update. Create a new room to keep playing.";

/** Turn rooms left over from before a restart into notices for their players. */
export function noticeLostRooms() {
  const rows = sql!.exec<{ mode: string; code: string | null; members: string }>("select mode, code, members from live_rooms").toArray();
  for (const r of rows) {
    const priv = r.mode === "private";
    for (const id of JSON.parse(r.members) as string[]) {
      holdRoomGone(id, { code: r.code ?? undefined, reason: priv ? RESTART_ROOM : RESTART_MATCH, rejoin: false });
    }
    if (priv && r.code) store.set(`roomclosed:${r.code}`, RESTART_ROOM, 6 * 3600_000);
  }
  sql!.exec("delete from live_rooms");
}
