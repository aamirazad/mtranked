// One Room type drives every mode. Lifecycle:
// waiting -> ready_check (matchmade only) -> countdown -> racing -> finished -> closed
// (private rooms go back to countdown on rematch). The server is the referee:
// it picks the text, replays every keystroke and decides the result.
import { randomInt, randomUUID } from "node:crypto";
import {
  applyKey,
  calculateWpm,
  caretIndex,
  correctChars,
  createState,
  finalStats,
  generateText,
  randomSeed,
  RANKED_SETTINGS,
  type Keystroke,
  type TypingState,
} from "@mtr/engine";
import {
  COUNTDOWN_MS,
  MAX_PING_ALLOWANCE_MS,
  RACE_CAP_MS,
  READY_CHECK_MS,
  RECONNECT_GRACE_MS,
  type LivePlayer,
  type Mode,
  type PlayerPublic,
  type RaceResultRow,
  type RaceStart,
  type RoomPublic,
  type ServerMsg,
  type TextSettings,
} from "@mtr/race-protocol";
import { rate, ROOM_CAP_FREE, ROOM_CAP_SUBSCRIBER, ROOM_CODE_ALPHABET, SPEED_CEILING_WPM, xpForRace } from "@mtr/shared";
import { currentSeason, type RatingRow } from "@mtr/db";
import { deliver, rttOf, sendTo } from "./hub";
import type { Identity } from "./players";
import { NODE_ID, redis } from "./redis";
import { analyzeTiming, type Flag } from "./anticheat";
import { saveRace, type RatingUpdate } from "./persist";
import { recordDecline, requeue } from "./matchmaker";

const IDLE_FORFEIT_MS = 25_000;
const ROOM_IDLE_CLOSE_MS = 30 * 60_000;
const CASUAL_FORMATS: TextSettings[] = [
  RANKED_SETTINGS,
  { ...RANKED_SETTINGS, words: 30 },
  { ...RANKED_SETTINGS, words: 40, language: "english_1k" },
  { ...RANKED_SETTINGS, mode: "quote", quoteLength: "short" },
  { ...RANKED_SETTINGS, mode: "quote", quoteLength: "medium" },
];

export type Member = {
  idn: Identity;
  info: PlayerPublic;
  connected: boolean;
  dcAt: number | null;
  ready: boolean;
  rating?: RatingRow;
  queueSince?: number;
};

type Racer = {
  id: string;
  info: PlayerPublic;
  userId?: string;
  state: TypingState;
  keys: Keystroke[];
  recv: number[];
  lastSeq: number;
  finishMs: number | null;
  finishOrder: number;
  out: boolean;
  forfeit: boolean;
  outAt: number | null;
  lastInputAt: number;
  ghost?: { keys: Keystroke[]; idx: number };
};

type Race = {
  id: string;
  matchId: string;
  seed: string;
  settings: TextSettings;
  text: string;
  source?: string;
  startAt: number;
  endAt: number;
  timeLimit: number;
  racers: Map<string, Racer>;
  finishCount: number;
  ended: boolean;
  ghostOf?: string;
};

export type GhostSource = {
  matchId: string;
  text: string;
  keys: Keystroke[];
  info: PlayerPublic;
};

export const rooms = new Map<string, Room>();
export const roomByCode = new Map<string, string>();
/** player id -> room id, for players whose room lives on this node */
export const playerRoom = new Map<string, string>();

export function roomOf(playerId: string): Room | undefined {
  const id = playerRoom.get(playerId);
  return id ? rooms.get(id) : undefined;
}

function newCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!roomByCode.has(code)) return code;
  }
}

export class Room {
  id = randomUUID();
  code?: string;
  status: "waiting" | "ready_check" | "countdown" | "racing" | "finished" | "closed" = "waiting";
  members = new Map<string, Member>();
  hostId?: string;
  settings: TextSettings;
  cap = 2;
  hostSubscriber = false;
  locked = false;
  scoreboard: Record<string, number> = {};
  racesRun = 0;
  lastActivity = Date.now();
  readyBy = 0;
  matchId = randomUUID();
  race: Race | null = null;
  ghost?: GhostSource;
  private lastSnapshot = 0;
  private lastSettingsSeed?: { seed: string; text: string; source?: string };

  constructor(
    public mode: Mode,
    settings: TextSettings,
  ) {
    this.settings = settings;
    rooms.set(this.id, this);
  }

  // ------------------------------------------------------------ construction
  static createMatch(mode: "ranked" | "casual", members: Member[]) {
    const settings = mode === "ranked" ? RANKED_SETTINGS : CASUAL_FORMATS[randomInt(CASUAL_FORMATS.length)]!;
    const room = new Room(mode, settings);
    for (const m of members) room.addMember(m);
    room.status = "ready_check";
    room.readyBy = Date.now() + READY_CHECK_MS;
    room.broadcast({
      type: "match.found",
      matchId: room.matchId,
      mode,
      players: members.map((m) => m.info),
      readyBy: room.readyBy,
    });
    room.snapshot(true);
    return room;
  }

  static createPrivate(host: Member, settings: TextSettings) {
    const room = new Room("private", settings);
    room.code = newCode();
    roomByCode.set(room.code, room.id);
    void redis.set(`roomcode:${room.code}`, room.id, "EX", 6 * 3600);
    room.hostId = host.idn.id;
    room.hostSubscriber = host.info.subscriber;
    room.cap = host.info.subscriber ? ROOM_CAP_SUBSCRIBER : ROOM_CAP_FREE;
    if (settings.mode === "custom" && !room.hostSubscriber) room.settings = { ...settings, mode: "words" };
    room.addMember(host);
    room.broadcastRoom();
    return room;
  }

  static async createGhost(member: Member, ghost: GhostSource) {
    const room = new Room("ghost", RANKED_SETTINGS);
    room.ghost = ghost;
    room.addMember(member);
    await room.startRace({ text: ghost.text, seed: "ghost:" + ghost.matchId });
    return room;
  }

  addMember(m: Member) {
    this.members.set(m.idn.id, m);
    playerRoom.set(m.idn.id, this.id);
    void redis.set(`proom:${m.idn.id}`, this.id, "EX", 3600);
  }

  // ------------------------------------------------------------ messaging
  broadcast(msg: ServerMsg) {
    deliver(this.members.keys(), msg);
  }

  publicState(): RoomPublic {
    return {
      code: this.code ?? "",
      hostId: this.hostId ?? "",
      locked: this.locked,
      cap: this.cap,
      hostSubscriber: this.hostSubscriber,
      settings: this.settings,
      players: [...this.members.values()].map((m) => m.info),
      status: this.status === "racing" || this.status === "countdown" ? this.status : this.racesRun ? "finished" : "waiting",
      scoreboard: this.scoreboard,
      races: this.racesRun,
    };
  }

  broadcastRoom() {
    if (this.mode === "private") this.broadcast({ type: "room.state", room: this.publicState() });
    this.snapshot(true);
  }

  /** Mirror room state to Redis (throttled while racing). */
  snapshot(force = false) {
    const now = Date.now();
    if (!force && now - this.lastSnapshot < 1000) return;
    this.lastSnapshot = now;
    const data = {
      node: NODE_ID,
      mode: this.mode,
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      settings: this.settings,
      members: [...this.members.keys()],
      race: this.race && {
        id: this.race.id,
        startAt: this.race.startAt,
        text: this.race.text,
        racers: [...this.race.racers.values()].map((r) => ({ id: r.id, keys: r.keys, finishMs: r.finishMs, out: r.out })),
      },
    };
    void redis.set(`room:${this.id}`, JSON.stringify(data), "EX", 3600);
  }

  raceStart(): RaceStart | null {
    const r = this.race;
    if (!r) return null;
    return {
      raceId: r.id,
      matchId: r.matchId,
      mode: this.mode,
      text: r.text,
      source: r.source,
      startAt: r.startAt,
      endAt: r.endAt,
      timeLimit: r.timeLimit,
      players: [...r.racers.values()].map((x) => x.info),
    };
  }

  // ------------------------------------------------------------ ready check
  onReady(playerId: string, matchId: string) {
    if (this.status !== "ready_check" || matchId !== this.matchId) return;
    const m = this.members.get(playerId);
    if (!m) return;
    m.ready = true;
    this.broadcast({ type: "match.ready", matchId, ready: [...this.members.values()].filter((x) => x.ready).map((x) => x.idn.id) });
    if ([...this.members.values()].every((x) => x.ready)) void this.startRace();
  }

  onDecline(playerId: string, matchId: string) {
    if (this.status !== "ready_check" || matchId !== this.matchId) return;
    void this.cancelReadyCheck("declined", new Set([playerId]));
  }

  private async cancelReadyCheck(reason: string, culprits?: Set<string>) {
    const bad = culprits ?? new Set([...this.members.values()].filter((m) => !m.ready).map((m) => m.idn.id));
    for (const m of this.members.values()) {
      const isBad = bad.has(m.idn.id);
      if (isBad) await recordDecline(m.idn.id);
      const requeued = !isBad && (this.mode === "ranked" || this.mode === "casual");
      sendTo(m.idn.id, {
        type: "match.cancelled",
        matchId: this.matchId,
        reason: isBad ? (reason === "declined" ? "You declined the match." : "You didn't ready up in time.") : "Your opponent didn't accept.",
        requeued,
      });
      if (requeued) await requeue(m, this.mode as "ranked" | "casual");
    }
    this.close();
  }

  // ------------------------------------------------------------ racing
  async startRace(reuse?: { seed: string; text: string; source?: string }) {
    if (this.status === "countdown" || this.status === "racing" || this.status === "closed") return;
    let gen = reuse;
    if (!gen) {
      const seed = randomSeed();
      const t = await generateText(this.settings, seed);
      gen = { seed, text: t.text, source: t.source };
    }
    this.lastSettingsSeed = gen;
    const now = Date.now();
    const startAt = now + COUNTDOWN_MS + 200;
    const timeLimit = this.settings.mode === "time" ? this.settings.time * 1000 : 0;
    const cap =
      timeLimit ||
      (this.mode === "private" ? Math.min(300_000, Math.max(RACE_CAP_MS, (gen.text.length / 5 / 20) * 60_000)) : RACE_CAP_MS);
    // every private-room race (and rematch) is its own match
    if (this.mode === "private") this.matchId = randomUUID();

    const racers = new Map<string, Racer>();
    for (const m of this.members.values()) {
      racers.set(m.idn.id, this.newRacer(m.idn.id, m.info, gen.text, startAt, m.idn.guest ? undefined : m.idn.id));
    }
    if (this.ghost) {
      const g = this.ghost;
      const racer = this.newRacer(g.info.id, g.info, gen.text, startAt);
      racer.ghost = { keys: g.keys, idx: 0 };
      racers.set(g.info.id, racer);
    }
    this.race = {
      id: randomUUID(),
      matchId: this.matchId,
      seed: gen.seed,
      settings: this.settings,
      text: gen.text,
      source: gen.source,
      startAt,
      endAt: startAt + cap,
      timeLimit,
      racers,
      finishCount: 0,
      ended: false,
      ghostOf: this.ghost?.matchId,
    };
    this.status = "countdown";
    this.lastActivity = now;
    this.broadcast({ type: "race.countdown", ...this.raceStart()! });
    this.broadcastRoom();
  }

  private newRacer(id: string, info: PlayerPublic, text: string, startAt: number, userId?: string): Racer {
    return {
      id,
      info,
      userId,
      state: createState(text),
      keys: [],
      recv: [],
      lastSeq: -1,
      finishMs: null,
      finishOrder: 0,
      out: false,
      forfeit: false,
      outAt: null,
      lastInputAt: startAt,
    };
  }

  onInput(playerId: string, raceId: string, seq: number, keys: Keystroke[]) {
    const race = this.race;
    if (!race || race.id !== raceId || race.ended) return;
    const now = Date.now();
    if (now < race.startAt) return;
    const r = race.racers.get(playerId);
    if (!r || r.out || r.finishMs !== null || seq <= r.lastSeq) return;
    r.lastSeq = seq;
    r.lastInputAt = now;
    const elapsed = now - race.startAt;
    const allowance = Math.min(rttOf(playerId) / 2, MAX_PING_ALLOWANCE_MS);
    let lastT = r.keys.at(-1)?.t ?? 0;
    for (const key of keys) {
      // client timestamps are only trusted within what the server observed
      const t = Math.round(Math.min(Math.max(key.t, lastT, 0), elapsed + 50));
      lastT = t;
      if (key.k.length !== 1) continue;
      applyKey(r.state, key.k);
      r.keys.push({ k: key.k, t });
      r.recv.push(elapsed);
      if (r.state.finished) {
        r.finishMs = Math.max(Math.round(elapsed - allowance), Math.min(t, elapsed));
        r.finishOrder = ++race.finishCount;
        break;
      }
    }
    if (race.timeLimit && elapsed >= race.timeLimit) this.forceEnd();
  }

  /** Player left mid-race (or lost connection beyond the grace period). */
  forfeit(playerId: string) {
    const r = this.race?.racers.get(playerId);
    if (!r || r.out || r.finishMs !== null || this.race!.ended) return;
    r.out = true;
    r.forfeit = true;
    r.outAt = Date.now() - this.race!.startAt;
  }

  private forceEnd() {
    if (this.race && !this.race.ended) void this.endRace();
  }

  tick(now: number) {
    if (this.status === "ready_check") {
      if (now > this.readyBy) void this.cancelReadyCheck("timeout");
      return;
    }
    if (this.status === "countdown" && this.race && now >= this.race.startAt) {
      this.status = "racing";
    }
    if (this.status === "racing" && this.race && !this.race.ended) {
      this.tickRace(now, this.race);
      return;
    }
    if (this.mode === "private" && (this.status === "waiting" || this.status === "finished")) {
      for (const m of [...this.members.values()]) {
        if (!m.connected && m.dcAt && now - m.dcAt > RECONNECT_GRACE_MS) this.removeMember(m.idn.id, null);
      }
      if (now - this.lastActivity > ROOM_IDLE_CLOSE_MS) this.close("Room closed after 30 minutes without a race.");
    }
  }

  private tickRace(now: number, race: Race) {
    const elapsed = now - race.startAt;
    for (const r of race.racers.values()) {
      if (r.ghost) {
        const g = r.ghost;
        while (g.idx < g.keys.length && g.keys[g.idx]!.t <= elapsed) {
          applyKey(r.state, g.keys[g.idx]!.k);
          r.keys.push(g.keys[g.idx]!);
          g.idx++;
          if (r.state.finished && r.finishMs === null) {
            r.finishMs = g.keys[g.idx - 1]!.t;
            r.finishOrder = ++race.finishCount;
          }
        }
        continue;
      }
      if (r.out || r.finishMs !== null) continue;
      const m = this.members.get(r.id);
      if (!m || (!m.connected && m.dcAt && now - m.dcAt > RECONNECT_GRACE_MS)) this.forfeit(r.id);
      else if (!race.timeLimit && now - r.lastInputAt > IDLE_FORFEIT_MS) this.forfeit(r.id);
    }

    const players: LivePlayer[] = [];
    for (const r of race.racers.values()) {
      const t = r.finishMs ?? (r.out ? (r.outAt ?? elapsed) : elapsed);
      players.push({
        id: r.id,
        idx: caretIndex(r.state),
        wpm: Math.round(calculateWpm(correctChars(r.state, true), t)),
        done: r.finishMs !== null,
        dc: !r.ghost && !this.members.get(r.id)?.connected,
        out: r.out,
      });
    }
    this.broadcast({ type: "race.state", raceId: race.id, t: elapsed, players });
    this.snapshot();

    const humans = [...race.racers.values()].filter((r) => !r.ghost);
    const humansDone = humans.every((r) => r.out || r.finishMs !== null);
    const allDone = [...race.racers.values()].every((r) => r.out || r.finishMs !== null);
    // ghost races end as soon as the human is done; otherwise wait for everyone
    if ((this.mode === "ghost" ? humansDone : allDone) || now >= race.endAt) void this.endRace();
  }

  // ------------------------------------------------------------ results
  private async endRace() {
    const race = this.race!;
    if (race.ended) return;
    race.ended = true;
    const now = Date.now();
    const elapsed = Math.min(now - race.startAt, race.endAt - race.startAt);
    const timed = race.timeLimit > 0;

    type Row = { r: Racer; result: RaceResultRow; flags: Flag[] };
    const rows: Row[] = [...race.racers.values()].map((r) => {
      const finished = timed ? !r.forfeit : r.finishMs !== null;
      const duration = timed ? (r.forfeit ? (r.outAt ?? elapsed) : race.timeLimit) : (r.finishMs ?? (r.out ? (r.outAt ?? elapsed) : elapsed));
      const st = finalStats(r.state, Math.max(1, duration));
      return {
        r,
        flags: [],
        result: {
          id: r.id,
          name: r.info.name,
          guest: r.info.guest,
          ghost: !!r.ghost,
          placement: 0,
          wpm: st.wpm,
          raw: st.raw,
          acc: st.acc,
          timeMs: finished ? Math.round(duration) : null,
          finished,
          forfeit: r.forfeit,
          progress: Math.round((st.prefix / r.state.textLength) * 1000) / 10,
        },
      };
    });

    rows.sort((a, b) => {
      const A = a.result;
      const B = b.result;
      if (A.forfeit !== B.forfeit) return A.forfeit ? 1 : -1;
      if (timed) return B.wpm - A.wpm;
      if (A.finished !== B.finished) return A.finished ? -1 : 1;
      if (A.finished) return A.timeMs! - B.timeMs! || a.r.finishOrder - b.r.finishOrder;
      return B.progress - A.progress || B.wpm - A.wpm;
    });
    rows.forEach((row, i) => (row.result.placement = i + 1));

    // ratings (ranked, two humans)
    const ratingUpdates = new Map<string, RatingUpdate>();
    let held = false;
    const season = await currentSeason().catch(() => null);
    if (this.mode === "ranked" && rows.length === 2 && !rows.every((x) => x.result.forfeit)) {
      held = rows.some((x) => x.result.wpm > SPEED_CEILING_WPM);
      const [w, l] = rows;
      const mw = this.members.get(w!.r.id)?.rating;
      const ml = this.members.get(l!.r.id)?.rating;
      if (mw && ml) {
        const gw = { rating: mw.rating, rd: mw.rd, vol: mw.volatility };
        const gl = { rating: ml.rating, rd: ml.rd, vol: ml.volatility };
        const nw = rate(gw, [{ opponent: gl, score: 1 }]);
        const nl = rate(gl, [{ opponent: gw, score: 0 }]);
        for (const [row, before, after, won, races] of [
          [w!, gw, nw, true, mw.races],
          [l!, gl, nl, false, ml.races],
        ] as const) {
          const delta = Math.round(after.rating) - Math.round(before.rating);
          ratingUpdates.set(row.r.id, { rating: after.rating, rd: after.rd, vol: after.vol, won, delta });
          row.result.ratingBefore = Math.round(before.rating);
          row.result.ratingAfter = held ? Math.round(before.rating) : Math.round(after.rating);
          row.result.delta = held ? 0 : delta;
          row.result.races = races + (held ? 0 : 1);
        }
      }
    }

    for (const row of rows) {
      const { r, result } = row;
      if (r.ghost || !r.userId) continue;
      result.xp = xpForRace({
        wpm: result.wpm,
        won: result.placement === 1 && rows.length > 1,
        finished: result.finished,
        mode: this.mode,
      });
      if (this.mode === "ghost") result.xp = Math.ceil(result.xp / 2);
      // no progression from results that look impossible
      if (result.wpm > SPEED_CEILING_WPM) result.xp = 0;
      if (this.mode === "ranked" || this.mode === "casual") row.flags = analyzeTiming(r.keys, r.recv);
    }

    let saved = false;
    try {
      await saveRace({
        matchId: race.matchId,
        mode: this.mode,
        seed: race.seed,
        settings: race.settings,
        text: race.text,
        seasonId: this.mode === "ranked" ? (season?.id ?? null) : null,
        startedAt: new Date(race.startAt),
        ghostOf: race.ghostOf,
        held,
        ratings: ratingUpdates,
        rows: rows.map((row) => ({
          userId: row.r.userId,
          guestName: row.r.userId ? undefined : row.r.ghost ? `ghost of ${row.r.info.name}` : row.r.info.name,
          result: row.result,
          keys: row.r.keys,
          flags: row.flags,
        })),
      });
      saved = true;
    } catch (e) {
      console.error("[race] failed to save", race.matchId, e);
    }

    if (this.mode === "private") {
      const winner = rows[0];
      if (winner && !winner.result.forfeit) this.scoreboard[winner.r.id] = (this.scoreboard[winner.r.id] ?? 0) + 1;
      this.racesRun++;
    }
    this.status = "finished";
    this.lastActivity = Date.now();
    this.broadcast({
      type: "race.result",
      raceId: race.id,
      matchId: race.matchId,
      mode: this.mode,
      results: rows.map((x) => x.result),
      held,
      saved,
    });
    if (this.mode === "private") this.broadcastRoom();
    else this.close();
  }

  // ------------------------------------------------------------ private rooms
  async onStart(playerId: string, sameText?: boolean) {
    if (playerId !== this.hostId || this.mode !== "private") return;
    if (this.status === "countdown" || this.status === "racing") return;
    await this.startRace(sameText && this.lastSettingsSeed ? this.lastSettingsSeed : undefined);
  }

  onSettings(playerId: string, settings: TextSettings) {
    if (playerId !== this.hostId || this.status === "countdown" || this.status === "racing") return;
    if (settings.mode === "custom" && (!this.hostSubscriber || !settings.custom?.trim())) {
      sendTo(playerId, { type: "error", code: "subscriber_only", message: "Custom text is a supporter perk." });
      return;
    }
    this.settings = settings;
    this.lastSettingsSeed = undefined;
    this.broadcastRoom();
  }

  join(m: Member): string | null {
    if (this.members.has(m.idn.id)) {
      this.reconnect(m.idn.id);
      return null;
    }
    if (this.locked) return "This room is locked.";
    if (this.members.size >= this.cap) return `This room is full (${this.cap} players).`;
    this.addMember(m);
    this.lastActivity = Date.now();
    this.broadcastRoom();
    const rs = this.raceStart();
    // let late joiners spectate the race in progress
    if (rs && (this.status === "countdown" || this.status === "racing")) sendTo(m.idn.id, { type: "race.resume", ...rs, keys: [] });
    return null;
  }

  removeMember(playerId: string, reason: string | null) {
    if (!this.members.has(playerId)) return;
    if (this.status === "racing" || this.status === "countdown") this.forfeit(playerId);
    this.members.delete(playerId);
    playerRoom.delete(playerId);
    void redis.del(`proom:${playerId}`);
    if (reason) sendTo(playerId, { type: "room.closed", reason });
    if (this.members.size === 0) return this.close();
    if (this.hostId === playerId) {
      const next = [...this.members.values()].find((m) => m.connected) ?? [...this.members.values()][0]!;
      this.hostId = next.idn.id;
      // the cap follows the host's plan; rooms already open keep their size
      this.hostSubscriber = next.info.subscriber;
    }
    this.broadcastRoom();
  }

  onKick(playerId: string, target: string) {
    if (playerId !== this.hostId || target === playerId) return;
    this.removeMember(target, "You were removed from the room by the host.");
  }

  onTransfer(playerId: string, target: string) {
    if (playerId !== this.hostId || !this.members.has(target)) return;
    this.hostId = target;
    this.broadcastRoom();
  }

  onLock(playerId: string, locked: boolean) {
    if (playerId !== this.hostId) return;
    this.locked = locked;
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ connections
  disconnect(playerId: string) {
    const m = this.members.get(playerId);
    if (!m) return;
    m.connected = false;
    m.dcAt = Date.now();
    if (this.mode === "ghost") this.close();
  }

  reconnect(playerId: string) {
    const m = this.members.get(playerId);
    if (!m) return;
    m.connected = true;
    m.dcAt = null;
    if (this.status === "ready_check") {
      sendTo(playerId, {
        type: "match.found",
        matchId: this.matchId,
        mode: this.mode,
        players: [...this.members.values()].map((x) => x.info),
        readyBy: this.readyBy,
      });
    }
    if (this.mode === "private") sendTo(playerId, { type: "room.state", room: this.publicState() });
    const rs = this.raceStart();
    if (rs && (this.status === "countdown" || this.status === "racing")) {
      const r = this.race!.racers.get(playerId);
      sendTo(playerId, { type: "race.resume", ...rs, keys: r?.out ? [] : (r?.keys ?? []) });
    }
  }

  close(reason?: string) {
    if (this.status === "closed") return;
    if (this.race && !this.race.ended) this.race.ended = true;
    this.status = "closed";
    for (const id of this.members.keys()) {
      if (playerRoom.get(id) === this.id) {
        playerRoom.delete(id);
        void redis.del(`proom:${id}`);
      }
      if (reason) sendTo(id, { type: "room.closed", reason });
    }
    rooms.delete(this.id);
    if (this.code) {
      roomByCode.delete(this.code);
      void redis.del(`roomcode:${this.code}`);
    }
    void redis.del(`room:${this.id}`);
  }
}

/** One timer drives every room on this node. */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    try {
      room.tick(now);
    } catch (e) {
      console.error("[room] tick failed", room.id, e);
    }
  }
}, 100).unref();
