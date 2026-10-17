// HTTP API contract (ts-rest + Zod), shared by the API server and the frontend.
import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { MAX_DISPLAY_NAME, type Equipped } from "@mtr/shared";

const c = initContract();

export const DisplayName = z
  .string()
  .trim()
  .min(3)
  .max(MAX_DISPLAY_NAME)
  .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, _ . - only");
export const Password = z.string().min(8, "At least 8 characters").max(200);
export const Email = z.string().trim().email().max(200);

/** One synced preference: its value and when (ms since epoch) it was changed. */
const pref = <T extends z.ZodTypeAny>(v: T) => z.object({ v, t: z.number().int().nonnegative() });
export const SyncedPrefs = z
  .object({
    theme: pref(z.string().max(32)),
    quickRestart: pref(z.enum(["off", "esc", "tab", "enter"])),
    roomThemes: pref(z.boolean()),
    fontSize: pref(z.number().min(0.5).max(4)),
    // these two were booleans before they got more choices; the frontend maps old values
    smoothCaret: pref(z.union([z.boolean(), z.string().max(16)])),
    liveWpm: pref(z.union([z.boolean(), z.string().max(16)])),
    // the frontend checks values against its option lists (lib/prefs.svelte.ts)
    liveAcc: pref(z.string().max(16)),
    liveBurst: pref(z.string().max(16)),
    liveProgress: pref(z.string().max(16)),
    fontFamily: pref(z.string().max(32)),
    soundOnClick: pref(z.string().max(32)),
    soundOnError: pref(z.string().max(32)),
    soundVolume: pref(z.number().min(0).max(1)),
    tapeMode: pref(z.string().max(16)),
    showAllLines: pref(z.boolean()),
    smoothLineScroll: pref(z.boolean()),
    highlightMode: pref(z.string().max(16)),
    indicateTypos: pref(z.string().max(16)),
    blindMode: pref(z.boolean()),
    hideExtraLetters: pref(z.boolean()),
    flipColors: pref(z.boolean()),
    colorfulMode: pref(z.boolean()),
    layout: pref(z.string().max(32)),
  })
  .partial();
export type SyncedPrefs = z.infer<typeof SyncedPrefs>;

export type ErrorBody = { message: string; fields?: Partial<Record<string, string>> };

export type Me = {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
  createdAt: string;
  country: string | null;
  subscriber: boolean;
  /** got supporter for free as one of the first users; never asked to pay */
  earlySupporter: boolean;
  moderator: boolean;
  xp: number;
  level: number;
  rating: number;
  rd: number;
  races: number;
  wins: number;
  peak: number;
  equipped: Equipped;
  rankedBlock: string | null;
  /** why a ban or timeout keeps this account out of ranked and casual; null if none */
  suspended: string | null;
  /** when the display name can next be changed; null if it can be changed now */
  nameChangeAt: string | null;
};

export type Guest = { id: string; name: string };

export type MatchSummary = {
  matchId: string;
  mode: string;
  status: string;
  finishedAt: string;
  placement: number;
  players: number;
  wpm: number;
  acc: number;
  delta: number | null;
  finished: boolean;
  opponent: string | null;
};

export type Profile = {
  id: string;
  name: string;
  country: string | null;
  createdAt: string;
  subscriber: boolean;
  level: number;
  xp: number;
  rating: number;
  races: number;
  wins: number;
  losses: number;
  peak: number;
  banner: string;
  caretColor: string;
  seasons: { seasonId: number; name: string; peak: number; races: number; current: boolean }[];
  stats: { avgWpm: number; bestWpm: number; avgAcc: number; total: number };
};

export type RatingPoint = { at: string; rating: number; races: number };

/** How results are grouped on the profile (ghost races count as casual). */
export const StatKind = z.enum(["ranked", "casual", "private", "practice"]);
export type StatKind = z.infer<typeof StatKind>;

export type KindStats = {
  kind: StatKind;
  /** results counted, finished or not */
  results: number;
  completed: number;
  /** results against at least one other player, and how many of those were won */
  versus: number;
  wins: number;
  avgWpm: number;
  bestWpm: number;
  avgAcc: number;
  avgConsistency: number | null;
  /** average wpm of the last 10 finished results */
  last10Wpm: number | null;
  timeMs: number;
};

export type PersonalBest = {
  wpm: number;
  raw: number;
  acc: number;
  consistency: number | null;
  at: string;
  kind: StatKind;
  language: string;
  punctuation: boolean;
  numbers: boolean;
  matchId: string | null;
};

export type ProfileStats = {
  totals: { results: number; completed: number; timeMs: number };
  kinds: KindStats[];
  /** best result per test length, keyed by seconds / word count */
  pbs: { time: Record<string, PersonalBest | null>; words: Record<string, PersonalBest | null> };
  ranked: {
    /** highest season peak ever */
    allTimePeak: number;
    bestWinStreak: number;
    winStreak: number;
    /** current season ladder position among placed players, null if not on it */
    rank: number | null;
    ladder: number;
  };
  /** consecutive UTC days with at least one result */
  streak: { current: number; best: number };
};

export type WpmPoint = { at: string; wpm: number; raw: number; acc: number; kind: StatKind };
export type ActivityDay = { date: string; count: number };

/** Settings of a practice test (custom text isn't saved). Extra keys are kept for newer generators. */
export const PracticeSettings = z
  .object({
    mode: z.enum(["words", "time", "quote"]),
    words: z.number().int().min(5).max(200),
    time: z.number().int().min(5).max(120),
    quoteLength: z.enum(["short", "medium", "long"]),
    punctuation: z.boolean(),
    numbers: z.boolean(),
    language: z.string().max(32),
  })
  .passthrough();
export type PracticeSettings = z.infer<typeof PracticeSettings>;

export type PracticeResult = {
  wpm: number;
  raw: number;
  acc: number;
  consistency: number;
  chars: [number, number, number, number];
  durationMs: number;
  /** best wpm for this exact test before this one, null if it's the first */
  previousBest: number | null;
};

export type PlayerHit = { name: string; country: string | null; rating: number; races: number; subscriber: boolean };

/** Another account on the friends page: a friend, or one side of a pending request. */
export type FriendRow = { id: string; name: string; level: number; country: string | null; subscriber: boolean; since: string };
export type FriendsList = { friends: FriendRow[]; incoming: FriendRow[]; outgoing: FriendRow[] };
/** How one player stands with another. */
export type FriendStatus = "none" | "friends" | "incoming" | "outgoing";
export const MAX_FRIENDS = 200;

export type LeaderboardRow = {
  rank: number;
  id: string;
  name: string;
  country: string | null;
  rating: number;
  races: number;
  wins: number;
  subscriber: boolean;
};

export type MatchDetail = {
  id: string;
  mode: string;
  status: string;
  text: string;
  seed: string;
  /** funboxes the race was played with (private rooms), needed to replay nospace-style funboxes */
  funbox?: string[];
  /** private-room gameplay rules the race was played with (the engine's Rules), needed to replay it */
  rules?: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  players: {
    slot: number;
    userId: string | null;
    name: string;
    placement: number;
    wpm: number;
    raw: number;
    acc: number;
    timeMs: number | null;
    finished: boolean;
    forfeit: boolean;
    delta: number | null;
    caretColor: string;
    keystrokes: { k: string; t: number }[] | null;
  }[];
};

export type ReportRow = {
  id: number;
  matchId: string;
  reason: string;
  status: string;
  createdAt: string;
  reporter: string | null;
  reported: string | null;
  reportedId: string | null;
  notes: string | null;
};

export type HeldMatch = { matchId: string; finishedAt: string; players: { name: string; wpm: number; acc: number }[] };
export type FlagRow = {
  id: number;
  user: string;
  userId: string;
  matchId: string | null;
  reason: string;
  details: unknown;
  createdAt: string;
  bannedAt: string | null;
  timedOutUntil: string | null;
};

/** Longest timeout a moderator can hand out, in hours (90 days). */
export const MAX_TIMEOUT_HOURS = 90 * 24;
const UserId = z.object({ id: z.string().uuid() });
const ModReason = z.string().trim().max(300).optional();

const err = c.type<ErrorBody>();
const ok = c.type<{ ok: true }>();

export const contract = c.router(
  {
    auth: {
      me: { method: "GET", path: "/auth/me", responses: { 200: c.type<{ user: Me | null; guest: Guest | null; supporterSales: boolean }>() } },
      signup: {
        method: "POST",
        path: "/auth/signup",
        body: z.object({ email: Email, password: Password, displayName: DisplayName }),
        responses: { 200: c.type<{ user: Me }>(), 400: err, 409: err, 429: err },
      },
      login: {
        method: "POST",
        path: "/auth/login",
        body: z.object({ email: Email, password: z.string().max(200) }),
        responses: { 200: c.type<{ user: Me }>(), 401: err, 429: err },
      },
      logout: { method: "POST", path: "/auth/logout", body: c.noBody(), responses: { 200: ok } },
      verify: {
        method: "POST",
        path: "/auth/verify",
        body: z.object({ token: z.string().max(200) }),
        responses: { 200: ok, 400: err },
      },
      resendVerification: {
        method: "POST",
        path: "/auth/resend-verification",
        body: c.noBody(),
        responses: { 200: ok, 401: err, 429: err },
      },
      forgot: {
        method: "POST",
        path: "/auth/forgot",
        body: z.object({ email: Email }),
        responses: { 200: ok, 429: err },
      },
      reset: {
        method: "POST",
        path: "/auth/reset",
        body: z.object({ token: z.string().max(200), password: Password }),
        responses: { 200: ok, 400: err, 429: err },
      },
      sessions: {
        method: "GET",
        path: "/auth/sessions",
        responses: {
          200: c.type<{
            sessions: { id: string; current: boolean; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string }[];
          }>(),
          401: err,
        },
      },
      revokeSession: {
        method: "DELETE",
        path: "/auth/sessions/:id",
        body: c.noBody(),
        responses: { 200: ok, 401: err },
      },
      ticket: {
        method: "POST",
        path: "/auth/ticket",
        body: z.object({ guestName: DisplayName.optional() }),
        responses: { 200: c.type<{ ticket: string }>(), 400: err, 429: err },
      },
    },
    me: {
      update: {
        method: "PATCH",
        path: "/me",
        body: z.object({
          displayName: DisplayName.optional(),
          country: z.string().length(2).toUpperCase().nullable().optional(),
          equipped: z
            .object({
              caret_color: z.string(),
              caret_shape: z.string(),
              finish: z.string(),
              banner: z.string(),
            })
            .partial()
            .optional(),
        }),
        responses: { 200: c.type<{ user: Me }>(), 400: err, 401: err, 409: err },
      },
      /** merge this device's preferences into the account's; returns the merged set */
      prefs: {
        method: "PUT",
        path: "/me/prefs",
        body: SyncedPrefs,
        responses: { 200: c.type<{ prefs: SyncedPrefs }>(), 401: err },
      },
      cosmetics: {
        method: "GET",
        path: "/me/cosmetics",
        responses: { 200: c.type<{ unlocked: string[]; equipped: Equipped }>(), 401: err },
      },
    },
    users: {
      profile: {
        method: "GET",
        path: "/users/:name",
        responses: { 200: c.type<{ profile: Profile }>(), 404: err },
      },
      matches: {
        method: "GET",
        path: "/users/:name/matches",
        query: z.object({
          offset: z.coerce.number().int().min(0).default(0),
          kind: z.enum(["ranked", "casual", "private"]).default("ranked"),
        }),
        responses: { 200: c.type<{ matches: MatchSummary[]; more: boolean; limited: boolean }>(), 404: err },
      },
      ratingHistory: {
        method: "GET",
        path: "/users/:name/rating-history",
        responses: { 200: c.type<{ season: { id: number; name: string }; points: RatingPoint[] }>(), 404: err },
      },
      stats: {
        method: "GET",
        path: "/users/:name/stats",
        responses: { 200: c.type<{ stats: ProfileStats }>(), 404: err },
      },
      wpmHistory: {
        method: "GET",
        path: "/users/:name/wpm-history",
        query: z.object({ kind: StatKind.optional() }),
        responses: { 200: c.type<{ points: WpmPoint[] }>(), 404: err },
      },
      activity: {
        method: "GET",
        path: "/users/:name/activity",
        /** a calendar year, or the last 12 months when omitted */
        query: z.object({ year: z.coerce.number().int().min(2000).max(3000).optional() }),
        responses: { 200: c.type<{ days: ActivityDay[]; from: string; to: string; years: number[] }>(), 404: err },
      },
      search: {
        method: "GET",
        path: "/search/players",
        query: z.object({ q: z.string().trim().min(1).max(MAX_DISPLAY_NAME) }),
        responses: { 200: c.type<{ players: PlayerHit[] }>(), 429: err },
      },
    },
    friends: {
      list: {
        method: "GET",
        path: "/friends",
        responses: { 200: c.type<FriendsList>(), 401: err },
      },
      /** send a friend request; if they already asked you, this accepts it */
      request: {
        method: "POST",
        path: "/friends/requests",
        body: z.object({ name: z.string().trim().min(1).max(MAX_DISPLAY_NAME) }),
        responses: { 200: c.type<{ status: FriendStatus }>(), 400: err, 401: err, 404: err, 429: err },
      },
      accept: {
        method: "POST",
        path: "/friends/:id/accept",
        pathParams: UserId,
        body: c.noBody(),
        responses: { 200: ok, 401: err, 404: err },
      },
      /** unfriend, decline an incoming request or cancel an outgoing one */
      remove: {
        method: "DELETE",
        path: "/friends/:id",
        pathParams: UserId,
        body: c.noBody(),
        responses: { 200: ok, 401: err },
      },
    },
    practice: {
      /** save a finished practice test; the server regenerates the text and replays the keys */
      submit: {
        method: "POST",
        path: "/practice",
        body: z.object({
          settings: PracticeSettings,
          seed: z.string().min(1).max(64),
          keys: z
            .array(z.object({ k: z.string().min(1).max(2), t: z.number().min(0).max(300000) }))
            .min(1)
            .max(4000),
        }),
        responses: { 200: c.type<{ result: PracticeResult }>(), 400: err, 401: err, 429: err },
      },
    },
    leaderboard: {
      method: "GET",
      path: "/leaderboard",
      query: z.object({ country: z.string().length(2).optional() }),
      responses: { 200: c.type<{ season: { id: number; name: string; endsAt: string }; rows: LeaderboardRow[] }>() },
    },
    season: {
      method: "GET",
      path: "/season",
      responses: { 200: c.type<{ id: number; name: string; startsAt: string; endsAt: string }>() },
    },
    match: {
      method: "GET",
      path: "/matches/:id",
      responses: { 200: c.type<{ match: MatchDetail }>(), 403: err, 404: err },
    },
    report: {
      method: "POST",
      path: "/reports",
      body: z.object({
        matchId: z.string().uuid(),
        reportedUserId: z.string().uuid().optional(),
        reason: z.string().trim().min(3).max(500),
      }),
      responses: { 200: ok, 400: err, 401: err, 429: err },
    },
    mod: {
      reports: { method: "GET", path: "/mod/reports", responses: { 200: c.type<{ reports: ReportRow[] }>(), 403: err } },
      resolveReport: {
        method: "POST",
        path: "/mod/reports/:id",
        body: z.object({
          action: z.enum(["dismiss", "ban", "timeout", "flag"]),
          /** timeout length, required for the timeout action */
          hours: z.number().int().min(1).max(MAX_TIMEOUT_HOURS).optional(),
          /** shown to the player for a ban or timeout */
          reason: ModReason,
          notes: z.string().max(1000).optional(),
        }),
        responses: { 200: ok, 400: err, 403: err, 404: err },
      },
      held: { method: "GET", path: "/mod/held", responses: { 200: c.type<{ matches: HeldMatch[] }>(), 403: err } },
      resolveHeld: {
        method: "POST",
        path: "/mod/held/:id",
        body: z.object({ action: z.enum(["approve", "void"]) }),
        responses: { 200: ok, 403: err, 404: err },
      },
      flags: { method: "GET", path: "/mod/flags", responses: { 200: c.type<{ flags: FlagRow[] }>(), 403: err } },
      unflag: {
        method: "POST",
        path: "/mod/users/:id/unflag",
        body: c.noBody(),
        responses: { 200: ok, 403: err },
      },
      ban: {
        method: "POST",
        path: "/mod/users/:id/ban",
        pathParams: UserId,
        body: z.object({ reason: ModReason }),
        responses: { 200: ok, 400: err, 403: err, 404: err },
      },
      timeout: {
        method: "POST",
        path: "/mod/users/:id/timeout",
        pathParams: UserId,
        body: z.object({ hours: z.number().int().min(1).max(MAX_TIMEOUT_HOURS), reason: ModReason }),
        responses: { 200: ok, 400: err, 403: err, 404: err },
      },
      /** lift any ban or timeout */
      unsuspend: {
        method: "POST",
        path: "/mod/users/:id/unsuspend",
        pathParams: UserId,
        body: c.noBody(),
        responses: { 200: ok, 403: err, 404: err },
      },
    },
    billing: {
      status: {
        method: "GET",
        path: "/billing",
        responses: {
          200: c.type<{ enabled: boolean; status: string; renewsAt: string | null; subscriber: boolean }>(),
          401: err,
        },
      },
      checkout: {
        method: "POST",
        path: "/billing/checkout",
        body: z.object({ interval: z.enum(["month", "year"]) }),
        responses: { 200: c.type<{ url: string }>(), 400: err, 401: err },
      },
      portal: {
        method: "POST",
        path: "/billing/portal",
        body: c.noBody(),
        responses: { 200: c.type<{ url: string }>(), 400: err, 401: err },
      },
      devToggle: {
        method: "POST",
        path: "/billing/dev-toggle",
        body: c.noBody(),
        responses: { 200: ok, 401: err, 404: err },
      },
    },
  },
  { pathPrefix: "/api", strictStatusCodes: true },
);
