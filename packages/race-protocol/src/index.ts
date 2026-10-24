// Every WebSocket message exchanged between the frontend and the realtime server.
import { z } from "zod";
import {
  CONFIDENCE,
  DIFFICULTY,
  FUNBOX_IDS,
  LANGUAGES,
  MAX_MIN_WPM,
  STOP_ON_ERROR,
  type CharStats,
  type FailReason,
  type TimelinePoint,
  type WordStat,
} from "@mtr/engine";

export const Mode = z.enum(["ranked", "casual", "private", "ghost"]);
export type Mode = z.infer<typeof Mode>;
export const QueueMode = z.enum(["ranked", "casual"]);
export type QueueMode = z.infer<typeof QueueMode>;

/**
 * Gameplay rules a private-room host sets for everyone in the room (see
 * @mtr/engine rules.ts). Omitted = no rules. Matchmade races never have rules:
 * the server strips them.
 */
export const RoomRules = z
  .object({
    stopOnError: z.enum(STOP_ON_ERROR),
    confidence: z.enum(CONFIDENCE),
    freedom: z.boolean(),
    strictSpace: z.boolean(),
    difficulty: z.enum(DIFFICULTY),
    lazy: z.boolean(),
    minWpm: z.number().int().min(0).max(MAX_MIN_WPM),
    minAcc: z.number().int().min(0).max(100),
    minBurst: z.number().int().min(0).max(MAX_MIN_WPM),
    burstFlex: z.boolean(),
  })
  .partial();
export type RoomRules = z.infer<typeof RoomRules>;

export const TextSettings = z.object({
  mode: z.enum(["words", "time", "quote", "custom"]),
  words: z.number().int().min(5).max(200),
  time: z.number().int().min(0).max(120),
  quoteLength: z.enum(["short", "medium", "long"]),
  punctuation: z.boolean(),
  numbers: z.boolean(),
  language: z.enum(LANGUAGES),
  custom: z.string().max(5000).optional(),
  /** practice and private rooms only: the realtime server strips it from matchmade races */
  funbox: z.array(z.enum(FUNBOX_IDS)).max(16).optional(),
  rules: RoomRules.optional(),
});
export type TextSettings = z.infer<typeof TextSettings>;

export const ROOM_NAME_MAX = 32;

export const DEFAULT_ROOM_SETTINGS: TextSettings = {
  mode: "words",
  words: 25,
  time: 30,
  quoteLength: "short",
  punctuation: false,
  numbers: false,
  language: "english",
};

export const Keystroke = z.object({ k: z.string().min(1).max(2), t: z.number() });

export const PlayerPublic = z.object({
  id: z.string(),
  name: z.string(),
  guest: z.boolean(),
  ghost: z.boolean().optional(),
  rating: z.number().optional(),
  races: z.number().optional(),
  level: z.number(),
  caretColor: z.string(),
  caretShape: z.string(),
  /** equipped profile banner; omitted for the default plain one */
  banner: z.string().optional(),
  subscriber: z.boolean(),
});
export type PlayerPublic = z.infer<typeof PlayerPublic>;

// ---------------------------------------------------------------- client -> server
export const ClientMsg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), t: z.number() }),
  z.object({ type: z.literal("queue.join"), mode: QueueMode }),
  z.object({ type: z.literal("queue.leave") }),
  z.object({ type: z.literal("ghost.accept") }),
  z.object({ type: z.literal("ready"), matchId: z.string() }),
  z.object({ type: z.literal("decline"), matchId: z.string() }),
  /** `invite`: friends to invite straight away (the "race a friend" button) */
  z.object({
    type: z.literal("room.create"),
    settings: TextSettings,
    invite: z.array(z.string().max(64)).max(16).optional(),
  }),
  /** watch the race (or private room) this friend is in */
  z.object({ type: z.literal("spectate.start"), playerId: z.string().max(64) }),
  z.object({ type: z.literal("spectate.stop") }),
  /** ask to be let into the private room this friend is in */
  z.object({ type: z.literal("room.request"), playerId: z.string().max(64) }),
  /** a host lets a player who asked in, or turns them down */
  z.object({ type: z.literal("room.answer"), playerId: z.string().max(64), accept: z.boolean() }),
  /** invite friends to the room we're in */
  z.object({ type: z.literal("room.invite"), playerIds: z.array(z.string().max(64)).min(1).max(16) }),
  z.object({ type: z.literal("room.join"), code: z.string().min(4).max(8) }),
  z.object({ type: z.literal("room.leave") }),
  z.object({ type: z.literal("room.settings"), settings: TextSettings }),
  z.object({ type: z.literal("room.start"), sameText: z.boolean().optional() }),
  z.object({ type: z.literal("room.kick"), playerId: z.string() }),
  /** hosts can make other players hosts too, and take the role from any host (themselves included) */
  z.object({ type: z.literal("room.promote"), playerId: z.string() }),
  z.object({ type: z.literal("room.demote"), playerId: z.string() }),
  z.object({ type: z.literal("room.lock"), locked: z.boolean() }),
  /** host only: ends the room for everyone */
  z.object({ type: z.literal("room.close") }),
  z.object({ type: z.literal("room.rename"), name: z.string().max(ROOM_NAME_MAX) }),
  /** supporter hosts can dress the room in a theme (null clears it) */
  z.object({ type: z.literal("room.theme"), theme: z.string().max(32).nullable() }),
  /** a host who has finished gives everyone still typing HURRY_MS to finish */
  z.object({ type: z.literal("room.hurry") }),
  z.object({
    type: z.literal("input.batch"),
    raceId: z.string(),
    seq: z.number().int(),
    keys: z.array(Keystroke).max(200),
  }),
  z.object({ type: z.literal("race.leave") }),
  z.object({ type: z.literal("rematch.request"), matchId: z.string() }),
  z.object({ type: z.literal("rematch.decline"), matchId: z.string() }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

// ---------------------------------------------------------------- server -> client
export type LivePlayer = {
  id: string;
  /** caret index into the text */
  idx: number;
  wpm: number;
  done: boolean;
  dc: boolean;
  out: boolean;
  /** failed a room rule (min speed, difficulty, ...); also `out` */
  failed?: FailReason;
};

export type RaceResultRow = {
  id: string;
  name: string;
  guest: boolean;
  ghost?: boolean;
  /** a ghost's current rating, so a win over it has context */
  ghostRating?: { rating: number; races?: number };
  placement: number;
  wpm: number;
  raw: number;
  acc: number;
  timeMs: number | null;
  finished: boolean;
  forfeit: boolean;
  /** failed a room rule: shown as a DNF and placed after everyone who didn't */
  failed?: FailReason;
  progress: number;
  ratingBefore?: number;
  ratingAfter?: number;
  delta?: number;
  races?: number;
  xp?: number;
  /** per-second samples for the results graph */
  timeline?: TimelinePoint[];
  /** consistency of the per-second raw speed, 0-100 */
  consistency?: number;
  /** [correct, incorrect, extra, missed] characters */
  chars?: CharStats;
  /** input history: each word reached, what was typed and its burst wpm */
  words?: WordStat[];
};

export type RoomPublic = {
  code: string;
  /** everyone who can run the room; never empty */
  hosts: string[];
  locked: boolean;
  cap: number;
  hostSubscriber: boolean;
  /** set by supporter hosts */
  name: string | null;
  /** theme id set by supporter hosts; players see it while they're in the room */
  theme: string | null;
  settings: TextSettings;
  players: PlayerPublic[];
  /** friends someone in the room has invited who haven't joined yet */
  invited: string[];
  /** players who asked to join, waiting for a host to answer */
  requests: { id: string; name: string; level: number }[];
  /** watching without playing */
  spectators: { id: string; name: string }[];
  status: "waiting" | "countdown" | "racing" | "finished";
  scoreboard: Record<string, number>;
  races: number;
};

/** What a friend is up to, as their friends see it. */
export type FriendActivity =
  | { kind: "queue"; mode: QueueMode }
  /** a matchmade race (ranked, casual) or a ghost race */
  | { kind: "match"; mode: Mode }
  | { kind: "room"; racing: boolean; players: number; cap: number; locked: boolean; name: string | null };
export type FriendPresence = { online: boolean; activity: FriendActivity | null };

export type RaceStart = {
  raceId: string;
  matchId: string;
  mode: Mode;
  /** what's being typed, for the pre-race intro */
  settings: TextSettings;
  text: string;
  source?: string;
  startAt: number;
  endAt: number;
  timeLimit: number;
  /** set once the host calls time: the race ends here, finished or not */
  deadline?: number;
  players: PlayerPublic[];
};

/** What spectators are sent from the room they watch (wrapped in `spectate.msg`). */
export type SpectateMsg = Extract<
  ServerMsg,
  { type: "race.countdown" | "race.resume" | "race.state" | "race.deadline" | "race.result" | "room.state" }
>;
export const SPECTATE_TYPES: ReadonlySet<string> = new Set<SpectateMsg["type"]>([
  "race.countdown",
  "race.resume",
  "race.state",
  "race.deadline",
  "race.result",
  "room.state",
]);

export type ServerMsg =
  | { type: "hello"; you: PlayerPublic; serverTime: number; verified: boolean; rankedOk: boolean }
  | { type: "pong"; t: number; serverTime: number }
  | { type: "error"; code: string; message: string }
  | {
      type: "queue.status";
      mode: QueueMode;
      rating: number;
      since: number;
      range: number;
      size: number;
      ghostAvailable: boolean;
    }
  | { type: "queue.left"; reason?: string }
  | { type: "match.found"; matchId: string; mode: Mode; players: PlayerPublic[]; readyBy: number }
  | { type: "match.ready"; matchId: string; ready: string[] }
  | { type: "match.cancelled"; matchId: string; reason: string; requeued: boolean }
  /** a warning to show the player, e.g. about a forfeit penalty (held until they reconnect if they're offline) */
  | { type: "notice"; message: string }
  | { type: "room.state"; room: RoomPublic }
  /** we're out of a private room; `rejoin` means it's still open and we may come back */
  | { type: "room.closed"; reason: string; code?: string; rejoin?: boolean }
  | ({ type: "race.countdown" } & RaceStart)
  | ({ type: "race.resume"; keys: { k: string; t: number }[] } & RaceStart)
  | { type: "race.state"; raceId: string; t: number; players: LivePlayer[] }
  | { type: "race.deadline"; raceId: string; deadline: number }
  | {
      type: "race.result";
      raceId: string;
      matchId: string;
      mode: Mode;
      results: RaceResultRow[];
      held: boolean;
      saved: boolean;
      /** casual 1v1 series score by player id (only once a rematch has been played) */
      series?: Record<string, number>;
      /** a rematch can be requested until this server time */
      rematch?: { expiresAt: number };
    }
  | { type: "rematch.status"; matchId: string; requested: string[]; closed?: string }
  /** a friend invited us to their private room */
  | { type: "room.invite"; code: string; from: { id: string; name: string }; roomName: string | null; players: number }
  /** we're now watching what this friend is in */
  | { type: "spectate.started"; playerId: string; name: string; mode: Mode }
  | { type: "spectate.msg"; msg: SpectateMsg }
  /** nothing more to watch (the match ended, the room closed, ...) */
  | { type: "spectate.ended"; reason: string }
  /** our request to join was passed to the room's hosts */
  | { type: "room.requested"; playerId: string }
  /** a host let us in: head to the room */
  | { type: "room.admit"; code: string; playerId: string; by: string }
  | { type: "room.declined"; playerId: string; message: string }
  /** we just created a room and these friends are online: offer to invite them all */
  | { type: "room.suggest"; code: string; friends: string[] }
  /** every friend's presence, sent on connect and whenever the friends list changes */
  | { type: "friends.presence"; presence: Record<string, FriendPresence> }
  | { type: "friend.presence"; id: string; presence: FriendPresence }
  /** a friend request was sent, accepted or removed: refetch the list */
  | { type: "friends.changed" };

export function parseClientMsg(raw: string): ClientMsg | null {
  try {
    const r = ClientMsg.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const INPUT_BATCH_MS = 100;
export const STATE_TICK_MS = 100;
export const COUNTDOWN_MS = 3000;
/** matchmade races show the game type for this long before the countdown */
export const PREPARE_MS = 3000;
export const READY_CHECK_MS = 20_000;
export const RECONNECT_GRACE_MS = 15_000;
export const RACE_CAP_MS = 120_000;
export const MAX_PING_ALLOWANCE_MS = 150;
export const REMATCH_MS = 30_000;
export const HURRY_MS = 15_000;
/** how long a room invite (or an accepted request to join) stays valid */
export const INVITE_MS = 10 * 60_000;
