// Every WebSocket message exchanged between the frontend and the realtime server.
import { z } from "zod";
import { LANGUAGES } from "@mtr/engine";

export const Mode = z.enum(["ranked", "casual", "private", "ghost"]);
export type Mode = z.infer<typeof Mode>;
export const QueueMode = z.enum(["ranked", "casual"]);
export type QueueMode = z.infer<typeof QueueMode>;

export const TextSettings = z.object({
  mode: z.enum(["words", "time", "quote", "custom"]),
  words: z.number().int().min(5).max(200),
  time: z.number().int().min(0).max(120),
  quoteLength: z.enum(["short", "medium", "long"]),
  punctuation: z.boolean(),
  numbers: z.boolean(),
  language: z.enum(LANGUAGES),
  custom: z.string().max(5000).optional(),
});
export type TextSettings = z.infer<typeof TextSettings>;

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
  z.object({ type: z.literal("room.create"), settings: TextSettings }),
  z.object({ type: z.literal("room.join"), code: z.string().min(4).max(8) }),
  z.object({ type: z.literal("room.leave") }),
  z.object({ type: z.literal("room.settings"), settings: TextSettings }),
  z.object({ type: z.literal("room.start"), sameText: z.boolean().optional() }),
  z.object({ type: z.literal("room.kick"), playerId: z.string() }),
  z.object({ type: z.literal("room.transfer"), playerId: z.string() }),
  z.object({ type: z.literal("room.lock"), locked: z.boolean() }),
  z.object({
    type: z.literal("input.batch"),
    raceId: z.string(),
    seq: z.number().int(),
    keys: z.array(Keystroke).max(200),
  }),
  z.object({ type: z.literal("race.leave") }),
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
};

export type RaceResultRow = {
  id: string;
  name: string;
  guest: boolean;
  ghost?: boolean;
  placement: number;
  wpm: number;
  raw: number;
  acc: number;
  timeMs: number | null;
  finished: boolean;
  forfeit: boolean;
  progress: number;
  ratingBefore?: number;
  ratingAfter?: number;
  delta?: number;
  races?: number;
  xp?: number;
};

export type RoomPublic = {
  code: string;
  hostId: string;
  locked: boolean;
  cap: number;
  hostSubscriber: boolean;
  settings: TextSettings;
  players: PlayerPublic[];
  status: "waiting" | "countdown" | "racing" | "finished";
  scoreboard: Record<string, number>;
  races: number;
};

export type RaceStart = {
  raceId: string;
  matchId: string;
  mode: Mode;
  text: string;
  source?: string;
  startAt: number;
  endAt: number;
  timeLimit: number;
  players: PlayerPublic[];
};

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
  | { type: "room.state"; room: RoomPublic }
  | { type: "room.closed"; reason: string }
  | ({ type: "race.countdown" } & RaceStart)
  | ({ type: "race.resume"; keys: { k: string; t: number }[] } & RaceStart)
  | { type: "race.state"; raceId: string; t: number; players: LivePlayer[] }
  | {
      type: "race.result";
      raceId: string;
      matchId: string;
      mode: Mode;
      results: RaceResultRow[];
      held: boolean;
      saved: boolean;
    };

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
export const READY_CHECK_MS = 10_000;
export const RECONNECT_GRACE_MS = 15_000;
export const RACE_CAP_MS = 120_000;
export const MAX_PING_ALLOWANCE_MS = 150;
