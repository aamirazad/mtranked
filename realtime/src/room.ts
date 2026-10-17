// One Room type drives every mode. Lifecycle:
// waiting -> ready_check (matchmade only) -> countdown -> racing -> finished -> closed
// (private rooms go back to countdown on rematch). The server is the referee:
// it picks the text, replays every keystroke and decides the result.
import { randomInt, randomUUID } from "node:crypto";
import {
  applyKey,
  calculateWpm,
  caretIndex,
  charStats,
  consistency,
  checkLiveFail,
  correctChars,
  normalizeRules,
  createState,
  finalStats,
  funboxTypingOptions,
  generateText,
  raceTimeline,
  randomSeed,
  RANKED_SETTINGS,
  wordHistory,
  withFunbox,
  type FailReason,
  type Keystroke,
  type TypingState,
} from "@mtr/engine";
import {
  COUNTDOWN_MS,
  type FriendActivity,
  HURRY_MS,
  INVITE_MS,
  MAX_PING_ALLOWANCE_MS,
  PREPARE_MS,
  RACE_CAP_MS,
  READY_CHECK_MS,
  RECONNECT_GRACE_MS,
  REMATCH_MS,
  type LivePlayer,
  type Mode,
  type PlayerPublic,
  type RaceResultRow,
  type RaceStart,
  type RoomPublic,
  type ServerMsg,
  type TextSettings,
} from "@mtr/race-protocol";
import {
  isOffensiveName,
  OFFENSIVE_NAME_MESSAGE,
  rate,
  ROOM_CAP_FREE,
  ROOM_CAP_SUBSCRIBER,
  ROOM_CODE_ALPHABET,
  SPEED_CEILING_WPM,
  themeById,
  xpForRace,
} from "@mtr/shared";
import { currentSeason, type RatingRow } from "@mtr/db";
import { deliver, holdNotice, holdRoomGone, rttOf, sendTo } from "./hub";
import type { Identity } from "./players";
import { NODE_ID, redis } from "./redis";
import { analyzeTiming, type Flag } from "./anticheat";
import { saveRace, type RatingUpdate } from "./persist";
import { recordDecline, requeue, strikeWarning } from "./matchmaker";
import { offerRematch } from "./rematch";
import { clearActivity, friendsWith, setActivity } from "./friends";
import { reportError } from "./sentry";

const IDLE_FORFEIT_MS = 25_000;
const ROOM_IDLE_CLOSE_MS = 30 * 60_000;
/** how long a closed room's code still says "closed" instead of "no room" */
const CLOSED_CODE_TTL_S = 6 * 3600;
const AWAY_TOO_LONG = "You were away too long, so you were taken out of the room.";
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
  /** failed a room rule; also `out` */
  failed: FailReason | null;
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
  deadline?: number;
  racers: Map<string, Racer>;
  finishCount: number;
  ended: boolean;
  ghostOf?: string;
  /** last whole second the time-based rules (min speed/acc) were checked */
  ruleSec: number;
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

/**
 * Gameplay rules only apply in private rooms (everyone there shares the
 * host's). Ranked, casual and ghost races always race without them.
 */
export function withRules(mode: Mode, settings: TextSettings): TextSettings {
  const { rules, ...rest } = settings;
  const r = mode === "private" ? normalizeRules(rules) : undefined;
  return r ? { ...rest, rules: r } : rest;
}

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
  /** private rooms can have several hosts; any of them can promote, demote (even themselves) and run the room */
  hosts = new Set<string>();
  settings: TextSettings;
  cap = 2;
  hostSubscriber = false;
  name: string | null = null;
  theme: string | null = null;
  locked = false;
  scoreboard: Record<string, number> = {};
  /** casual rematch series score, carried from room to room */
  series?: Record<string, number>;
  racesRun = 0;
  lastActivity = Date.now();
  readyBy = 0;
  matchId = randomUUID();
  race: Race | null = null;
  ghost?: GhostSource;
  private lastSettingsSeed?: { seed: string; text: string; source?: string };
  /** players the host kicked; they can't come back unless a host invites them */
  private kicked = new Set<string>();
  /** friends invited in (by a host: past the lock too), by player id */
  private invites = new Map<string, { byHost: boolean; at: number }>();
  /** a start is in flight (text generation is async) */
  private starting = false;

  isHost(playerId: string) {
    return this.hosts.has(playerId);
  }

  /** room perks (name, theme) follow whether any host is a supporter */
  private refreshHostPerks() {
    this.hostSubscriber = [...this.hosts].some((id) => this.members.get(id)?.info.subscriber);
  }

  /** read through a getter so checks after an await aren't narrowed away */
  get closed() {
    return this.status === "closed";
  }

  /** a ready check, race or result save is under way (a restart waits for these) */
  get active() {
    return this.starting || this.status === "ready_check" || this.status === "countdown" || this.status === "racing";
  }

  constructor(
    public mode: Mode,
    settings: TextSettings,
  ) {
    // funbox and rules are for private rooms only, never matchmaking
    this.settings = withRules(mode, withFunbox(settings, mode === "private"));
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
    room.snapshot();
    return room;
  }

  /** Both players asked for a rematch: skip the ready check and start the race. */
  static async createRematch(members: Member[], series: Record<string, number>) {
    const room = new Room("casual", CASUAL_FORMATS[randomInt(CASUAL_FORMATS.length)]!);
    room.series = series;
    for (const m of members) room.addMember(m);
    await room.startRace();
    return room;
  }

  static createPrivate(host: Member, settings: TextSettings) {
    const room = new Room("private", settings);
    room.code = newCode();
    roomByCode.set(room.code, room.id);
    void redis.set(`roomcode:${room.code}`, room.id, "EX", 6 * 3600);
    room.hosts.add(host.idn.id);
    room.hostSubscriber = host.info.subscriber;
    room.cap = host.info.subscriber ? ROOM_CAP_SUBSCRIBER : ROOM_CAP_FREE;
    if (settings.mode === "custom" && !settings.custom?.trim()) room.settings = { ...room.settings, mode: "words" };
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
      hosts: [...this.hosts],
      locked: this.locked,
      cap: this.cap,
      hostSubscriber: this.hostSubscriber,
      name: this.name,
      theme: this.theme,
      settings: this.settings,
      players: [...this.members.values()].map((m) => m.info),
      invited: [...this.invites.keys()].filter((id) => this.invitedOk(id)),
      status: this.status === "racing" || this.status === "countdown" ? this.status : this.racesRun ? "finished" : "waiting",
      scoreboard: this.scoreboard,
      races: this.racesRun,
    };
  }

  broadcastRoom() {
    if (this.mode === "private") this.broadcast({ type: "room.state", room: this.publicState() });
    this.snapshot();
  }

  /** Mirror room metadata to Redis so other nodes can find the owner (only `node` is read). */
  snapshot() {
    const data = {
      node: NODE_ID,
      mode: this.mode,
      code: this.code,
      status: this.status,
      hosts: [...this.hosts],
      settings: this.settings,
      members: [...this.members.keys()],
    };
    void redis.set(`room:${this.id}`, JSON.stringify(data), "EX", 3600);
    const act = this.activity();
    for (const id of this.members.keys()) setActivity(id, act, this.id);
  }

  /** what friends of the players in here see them doing */
  private activity(): FriendActivity {
    if (this.mode !== "private") return { kind: "match", mode: this.mode };
    return {
      kind: "room",
      racing: this.status === "countdown" || this.status === "racing",
      players: this.members.size,
      cap: this.cap,
      locked: this.locked,
      name: this.name,
    };
  }

  raceStart(): RaceStart | null {
    const r = this.race;
    if (!r) return null;
    return {
      raceId: r.id,
      matchId: r.matchId,
      mode: this.mode,
      settings: r.settings,
      text: r.text,
      source: r.source,
      startAt: r.startAt,
      endAt: r.endAt,
      timeLimit: r.timeLimit,
      deadline: r.deadline,
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
      const requeued = !isBad && (this.mode === "ranked" || this.mode === "casual");
      const what = reason === "declined" ? "You declined the match and left the queue" : "You didn't ready up in time and left the queue";
      // only ranked declines count as strikes; casual just leaves the queue
      const why = !isBad
        ? "Your opponent didn't accept."
        : this.mode === "ranked"
          ? strikeWarning(what, await recordDecline(m.idn.id))
          : `${what}.`;
      sendTo(m.idn.id, { type: "match.cancelled", matchId: this.matchId, reason: why, requeued });
      if (!m.connected && !requeued) await holdNotice(m.idn.id, why);
      if (requeued) await requeue(m, this.mode as "ranked" | "casual");
    }
    this.close();
  }

  // ------------------------------------------------------------ racing
  async startRace(reuse?: { seed: string; text: string; source?: string }) {
    if (this.starting || this.status === "countdown" || this.status === "racing" || this.status === "closed") return;
    let gen = reuse;
    if (!gen) {
      this.starting = true;
      try {
        const seed = randomSeed();
        const t = await generateText(this.settings, seed);
        gen = { seed, text: t.text, source: t.source };
      } finally {
        this.starting = false;
      }
      if (this.closed) return;
    }
    this.lastSettingsSeed = gen;
    const now = Date.now();
    // matchmade games have a random format, so players get a moment to see what's coming
    const prepare = this.mode === "ranked" || this.mode === "casual" ? PREPARE_MS : 0;
    const startAt = now + prepare + COUNTDOWN_MS + 200;
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
      ruleSec: 0,
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
      state: createState(text, this.settings.rules, funboxTypingOptions(this.settings.funbox)),
      keys: [],
      recv: [],
      lastSeq: -1,
      finishMs: null,
      finishOrder: 0,
      out: false,
      forfeit: false,
      failed: null,
      outAt: null,
      lastInputAt: startAt,
    };
  }

  onInput(playerId: string, raceId: string, seq: number, keys: Keystroke[]) {
    const race = this.race;
    if (!race || race.id !== raceId || race.ended) return;
    const now = Date.now();
    if (now < race.startAt || now >= race.endAt) return;
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
      applyKey(r.state, key.k, t);
      r.keys.push({ k: key.k, t });
      r.recv.push(elapsed);
      if (r.state.finished) {
        r.finishMs = Math.max(Math.round(elapsed - allowance), Math.min(t, elapsed));
        r.finishOrder = ++race.finishCount;
        break;
      }
      if (r.state.failed) {
        this.failRacer(r, t);
        break;
      }
    }
    if (race.timeLimit && elapsed >= race.timeLimit) this.forceEnd();
  }

  /** A room rule failed this racer: they're out of this race (a DNF, not a forfeit). */
  private failRacer(r: Racer, atMs: number) {
    r.out = true;
    r.failed = r.state.failed;
    r.outAt = atMs;
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
        if (!m.connected && m.dcAt && now - m.dcAt > RECONNECT_GRACE_MS) {
          this.removeMember(m.idn.id, null);
          // they're offline: tell them when they're back (the room may have closed without them)
          void holdRoomGone(
            m.idn.id,
            this.closed
              ? { code: this.code, reason: "The room closed while you were away.", rejoin: false }
              : { code: this.code, reason: AWAY_TOO_LONG, rejoin: true },
          );
        }
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
          applyKey(r.state, g.keys[g.idx]!.k, g.keys[g.idx]!.t);
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

    // min speed / min accuracy rules: checked once per second, like monkeytype's timer
    const sec = Math.floor(elapsed / 1000);
    if (sec > race.ruleSec && (race.settings.rules?.minWpm || race.settings.rules?.minAcc)) {
      race.ruleSec = sec;
      for (const r of race.racers.values()) {
        if (r.ghost || r.out || r.finishMs !== null) continue;
        if (checkLiveFail(r.state, sec * 1000)) this.failRacer(r, sec * 1000);
      }
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
        ...(r.failed ? { failed: r.failed } : {}),
      });
    }
    this.broadcast({ type: "race.state", raceId: race.id, t: elapsed, players });

    const humans = [...race.racers.values()].filter((r) => !r.ghost);
    const humansDone = humans.every((r) => r.out || r.finishMs !== null);
    const allDone = [...race.racers.values()].every((r) => r.out || r.finishMs !== null);
    // a forfeit hands a matchmade 1v1 to whoever stayed
    const walkover = (this.mode === "ranked" || this.mode === "casual") && humans.some((r) => r.forfeit);
    // ghost races end as soon as the human is done; otherwise wait for everyone
    if ((this.mode === "ghost" ? humansDone : allDone) || walkover || now >= race.endAt) void this.endRace();
  }

  // ------------------------------------------------------------ results
  private async endRace() {
    const race = this.race!;
    if (race.ended) return;
    race.ended = true;
    try {
      await this.scoreRace(race);
    } catch (e) {
      reportError("[race] failed to finish", e, { matchId: race.matchId });
      if (this.closed) return;
      // never leave the room stuck mid-race
      this.status = "finished";
      this.lastActivity = Date.now();
      this.broadcast({ type: "error", code: "race_failed", message: "Something went wrong scoring that race." });
      if (this.mode === "private") this.broadcastRoom();
      else this.close();
    }
  }

  private async scoreRace(race: Race) {
    const now = Date.now();
    const elapsed = Math.min(now - race.startAt, race.endAt - race.startAt);
    const timed = race.timeLimit > 0;

    type Row = { r: Racer; result: RaceResultRow; flags: Flag[]; durationMs: number };
    const rows: Row[] = [...race.racers.values()].map((r) => {
      const finished = timed ? !r.forfeit && !r.failed : r.finishMs !== null;
      const duration = timed
        ? r.forfeit || r.failed
          ? (r.outAt ?? elapsed)
          : race.timeLimit
        : (r.finishMs ?? (r.out ? (r.outAt ?? elapsed) : elapsed));
      const st = finalStats(r.state, Math.max(1, duration));
      const fbOpts = funboxTypingOptions(race.settings.funbox);
      const timeline = raceTimeline(race.text, r.keys, Math.max(1, duration), race.settings.rules, fbOpts);
      return {
        r,
        flags: [],
        durationMs: Math.round(duration),
        result: {
          id: r.id,
          name: r.info.name,
          guest: r.info.guest,
          ghost: !!r.ghost,
          ghostRating: r.ghost && r.info.rating !== undefined ? { rating: r.info.rating, races: r.info.races } : undefined,
          placement: 0,
          wpm: st.wpm,
          raw: st.raw,
          acc: st.acc,
          timeMs: finished ? Math.round(duration) : null,
          finished,
          forfeit: r.forfeit,
          ...(r.failed ? { failed: r.failed } : {}),
          progress: Math.round((st.prefix / r.state.textLength) * 1000) / 10,
          timeline,
          consistency: consistency(timeline),
          chars: charStats(r.state),
          words: wordHistory(race.text, r.keys, duration, race.settings.rules, fbOpts),
        },
      };
    });

    rows.sort((a, b) => {
      const A = a.result;
      const B = b.result;
      if (A.forfeit !== B.forfeit) return A.forfeit ? 1 : -1;
      if (!!A.failed !== !!B.failed) return A.failed ? 1 : -1;
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
          durationMs: row.durationMs,
          keys: row.r.keys,
          flags: row.flags,
        })),
      });
      saved = true;
    } catch (e) {
      reportError("[race] failed to save", e, { matchId: race.matchId });
    }
    // the room may have been closed while we were saving
    if (this.closed) return;

    // casual 1v1: update the running series and offer a rematch
    let series: Record<string, number> | undefined;
    let rematch: { expiresAt: number } | undefined;
    if (this.mode === "casual" && rows.length === 2) {
      series = this.series ? { ...this.series } : Object.fromEntries(rows.map((x) => [x.r.id, 0]));
      const winner = rows[0]!;
      if (!winner.result.forfeit) series[winner.r.id] = (series[winner.r.id] ?? 0) + 1;
      const members = rows.map((x) => this.members.get(x.r.id));
      if (!rows.some((x) => x.result.forfeit) && members.every((m) => m)) {
        try {
          await offerRematch(race.matchId, members as Member[], series);
          rematch = { expiresAt: Date.now() + REMATCH_MS };
        } catch (e) {
          reportError("[race] failed to offer rematch", e, { matchId: race.matchId });
        }
      }
    }
    if (this.closed) return;

    if (this.mode === "private") {
      const winner = rows[0];
      if (winner && !winner.result.forfeit && !winner.result.failed) this.scoreboard[winner.r.id] = (this.scoreboard[winner.r.id] ?? 0) + 1;
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
      series: this.series ? series : undefined,
      rematch,
    });
    if (this.mode === "private") this.broadcastRoom();
    else this.close();
  }

  // ------------------------------------------------------------ private rooms
  async onStart(playerId: string, sameText?: boolean) {
    if (!this.isHost(playerId) || this.mode !== "private") return;
    if (this.status === "countdown" || this.status === "racing") return;
    await this.startRace(sameText && this.lastSettingsSeed ? this.lastSettingsSeed : undefined);
  }

  /** The host is done and tired of waiting: everyone still typing gets HURRY_MS to finish. */
  onHurry(playerId: string) {
    const race = this.race;
    if (!this.isHost(playerId) || this.mode !== "private" || this.status !== "racing") return;
    if (!race || race.ended || race.timeLimit || race.deadline) return;
    if (race.racers.get(playerId)?.finishMs == null) return;
    race.deadline = Math.min(race.endAt, Date.now() + HURRY_MS);
    race.endAt = race.deadline;
    this.broadcast({ type: "race.deadline", raceId: race.id, deadline: race.deadline });
  }

  onSettings(playerId: string, settings: TextSettings) {
    if (!this.isHost(playerId) || this.status === "countdown" || this.status === "racing") return;
    if (settings.mode === "custom" && !settings.custom?.trim()) {
      sendTo(playerId, { type: "error", code: "custom_empty", message: "Custom text can't be empty." });
      return;
    }
    this.settings = withRules(this.mode, withFunbox(settings, this.mode === "private"));
    this.lastSettingsSeed = undefined;
    this.broadcastRoom();
  }

  join(m: Member): string | null {
    if (this.members.has(m.idn.id)) {
      this.reconnect(m.idn.id);
      return null;
    }
    const invite = this.invitedOk(m.idn.id) ? this.invites.get(m.idn.id) : undefined;
    if (this.kicked.has(m.idn.id)) return "You were removed from this room by the host.";
    if (this.locked && !invite?.byHost) return "This room is locked.";
    if (this.members.size >= this.cap) return `This room is full (${this.cap} players).`;
    this.invites.delete(m.idn.id);
    this.addMember(m);
    this.lastActivity = Date.now();
    this.broadcastRoom();
    const rs = this.raceStart();
    // let late joiners spectate the race in progress
    if (rs && (this.status === "countdown" || this.status === "racing")) sendTo(m.idn.id, { type: "race.resume", ...rs, keys: [] });
    return null;
  }

  removeMember(playerId: string, reason: string | null) {
    const m = this.members.get(playerId);
    if (!m) return;
    if (this.status === "racing" || this.status === "countdown") this.forfeit(playerId);
    this.members.delete(playerId);
    playerRoom.delete(playerId);
    void redis.del(`proom:${playerId}`);
    clearActivity(playerId, this.id);
    if (reason) {
      sendTo(playerId, { type: "room.closed", code: this.code, reason, rejoin: false });
      if (!m.connected) void holdRoomGone(playerId, { code: this.code, reason, rejoin: false });
    }
    if (this.members.size === 0) return this.close("Everyone left, so the room closed.");
    if (this.hosts.delete(playerId)) {
      if (!this.hosts.size) {
        const next = [...this.members.values()].find((m) => m.connected) ?? [...this.members.values()][0]!;
        this.hosts.add(next.idn.id);
      }
      // rooms already open keep their size; only the perks follow the hosts
      this.refreshHostPerks();
    }
    this.broadcastRoom();
  }

  onKick(playerId: string, target: string) {
    if (!this.isHost(playerId) || target === playerId || !this.members.has(target)) return;
    this.kicked.add(target);
    this.removeMember(target, "You were removed from the room by the host.");
  }

  /** Make another player a host too; the one promoting stays a host. */
  onPromote(playerId: string, target: string) {
    if (!this.isHost(playerId) || !this.members.has(target) || this.isHost(target)) return;
    this.hosts.add(target);
    this.refreshHostPerks();
    this.broadcastRoom();
  }

  /** Any host can take the host role away from any host, themselves included, as long as one is left. */
  onDemote(playerId: string, target: string) {
    if (!this.isHost(playerId) || !this.isHost(target)) return;
    if (this.hosts.size === 1) {
      sendTo(playerId, { type: "error", code: "last_host", message: "A room needs a host. Make someone else a host first." });
      return;
    }
    this.hosts.delete(target);
    this.refreshHostPerks();
    this.broadcastRoom();
  }

  private invitedOk(id: string) {
    const inv = this.invites.get(id);
    return !!inv && Date.now() - inv.at < INVITE_MS;
  }

  /** Invite some of the player's friends in. Invites from a host get past the lock (and a kick). */
  async onInvite(playerId: string, ids: string[]) {
    const from = this.members.get(playerId);
    if (this.mode !== "private" || !from || this.closed) return;
    const wanted = [...new Set(ids)].filter((id) => id !== playerId && !this.members.has(id));
    const ok = await friendsWith(playerId, wanted);
    if (this.closed || !ok.size) return;
    const byHost = this.isHost(playerId);
    const now = Date.now();
    const sent: string[] = [];
    for (const id of ok) {
      const prev = this.invites.get(id);
      // don't let a room nag someone: one invite per player every 30s
      if (prev && now - prev.at < 30_000 && (prev.byHost || !byHost)) continue;
      if (byHost) this.kicked.delete(id);
      this.invites.set(id, { byHost: byHost || !!prev?.byHost, at: now });
      sent.push(id);
    }
    if (!sent.length) return;
    deliver(sent, {
      type: "room.invite",
      code: this.code!,
      from: { id: playerId, name: from.info.name },
      roomName: this.name,
      players: this.members.size,
    });
    this.broadcastRoom();
  }

  onClose(playerId: string) {
    if (!this.isHost(playerId) || this.mode !== "private") return;
    this.close("The host closed the room.");
  }

  onLock(playerId: string, locked: boolean) {
    if (!this.isHost(playerId)) return;
    this.locked = locked;
    this.broadcastRoom();
  }

  onRename(playerId: string, name: string) {
    if (!this.isHost(playerId)) return;
    if (!this.hostSubscriber) {
      sendTo(playerId, { type: "error", code: "subscriber_only", message: "Naming rooms is a supporter perk." });
      return;
    }
    const clean = name.replace(/\p{C}/gu, "").replace(/\s+/g, " ").trim();
    if (isOffensiveName(clean)) {
      sendTo(playerId, { type: "error", code: "name_rejected", message: OFFENSIVE_NAME_MESSAGE });
      return;
    }
    this.name = clean || null;
    this.broadcastRoom();
  }

  onTheme(playerId: string, theme: string | null) {
    if (!this.isHost(playerId)) return;
    if (!this.hostSubscriber) {
      sendTo(playerId, { type: "error", code: "subscriber_only", message: "Room themes are a supporter perk." });
      return;
    }
    if (theme !== null && !themeById(theme)) return;
    this.theme = theme;
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

  /** `reason` is only shown for private rooms (matchmade rooms close quietly after results). */
  close(reason?: string) {
    if (this.status === "closed") return;
    if (this.race && !this.race.ended) this.race.ended = true;
    this.status = "closed";
    const priv = this.mode === "private";
    const why = reason ?? "This room was closed.";
    for (const [id, m] of this.members) {
      if (playerRoom.get(id) === this.id) {
        playerRoom.delete(id);
        void redis.del(`proom:${id}`);
      }
      clearActivity(id, this.id);
      if (!priv) continue;
      sendTo(id, { type: "room.closed", code: this.code, reason: why, rejoin: false });
      if (!m.connected) void holdRoomGone(id, { code: this.code, reason: why, rejoin: false });
    }
    rooms.delete(this.id);
    if (this.code) {
      roomByCode.delete(this.code);
      void redis.del(`roomcode:${this.code}`);
      // so a reload or late invite link says it closed rather than "no room with that code"
      if (priv) void redis.set(`roomclosed:${this.code}`, why, "EX", CLOSED_CODE_TTL_S);
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
      reportError("[room] tick failed", e, { roomId: room.id });
    }
  }
}, 100).unref();
