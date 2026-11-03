// D1 access and the queries shared by the API and the Hub (ported from packages/db).
// Timestamps are integer ms, booleans 0/1 and JSON columns text; rows are converted at the edges.
import { env } from "cloudflare:workers";
import {
  COSMETICS,
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOL,
  levelFromXp,
  PLACEMENT_RACES,
  resolveEquipped,
  tierFor,
  tierIndex,
  type Equipped,
} from "@mtr/shared";

export type Row = Record<string, unknown>;
export const db = () => env.DB;

/** A prepared statement with its parameters (undefined is bound as null). */
export const q = (sql: string, ...params: unknown[]) => db().prepare(sql).bind(...params.map((p) => p ?? null));

export async function all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await q(sql, ...params).all<T>()).results;
}
export async function one<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return (await q(sql, ...params).first<T>()) ?? undefined;
}
export async function run(sql: string, ...params: unknown[]) {
  return (await q(sql, ...params).run()).meta;
}
/** Run statements atomically (D1 batches are a single transaction). */
export const batch = (stmts: D1PreparedStatement[]) => (stmts.length ? db().batch(stmts) : Promise.resolve([]));

export const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
export const bool = (v: unknown) => v === 1 || v === true;
export const iso = (ms: unknown) => new Date(Number(ms)).toISOString();
export const isoOrNull = (ms: unknown) => (ms == null ? null : iso(ms));
/** `?, ?, ?` for an IN list. */
export const marks = (n: number) => Array(n).fill("?").join(", ");
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ------------------------------------------------------------------ seasons
export type Season = { id: number; name: string; starts_at: number; ends_at: number; reset_params: { pull: number; rd: number } };

let seasonCache: { s: Season; at: number } | undefined;
export async function currentSeason(): Promise<Season> {
  const now = Date.now();
  if (seasonCache && now - seasonCache.at < 60_000 && seasonCache.s.ends_at > now) return seasonCache.s;
  const r = await one("select * from seasons where starts_at <= ? order by starts_at desc limit 1", now);
  if (!r) throw new Error("No season configured. Apply the D1 migrations.");
  const s: Season = {
    id: Number(r.id),
    name: String(r.name),
    starts_at: Number(r.starts_at),
    ends_at: Number(r.ends_at),
    reset_params: json(r.reset_params, { pull: 0.5, rd: 250 }),
  };
  seasonCache = { s, at: now };
  return s;
}
export const forgetSeason = () => (seasonCache = undefined);

// ------------------------------------------------------------------ ratings
export type RatingRow = {
  user_id: string;
  season_id: number;
  rating: number;
  rd: number;
  volatility: number;
  races: number;
  wins: number;
  peak: number;
};

export async function getRating(userId: string, seasonId: number): Promise<RatingRow> {
  const r = await one<RatingRow>(
    "select user_id, season_id, rating, rd, volatility, races, wins, peak from ratings where user_id = ? and season_id = ?",
    userId,
    seasonId,
  );
  return (
    r ?? {
      user_id: userId,
      season_id: seasonId,
      rating: DEFAULT_RATING,
      rd: DEFAULT_RD,
      volatility: DEFAULT_VOL,
      races: 0,
      wins: 0,
      peak: 0,
    }
  );
}

export const isPlaced = (races: number) => races >= PLACEMENT_RACES;

// ------------------------------------------------------------------ users
export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  email_verified_at: number | null;
  has_password: boolean;
  created_at: number;
  country: string | null;
  is_subscriber: boolean;
  early_supporter: boolean;
  is_moderator: boolean;
  is_bot: boolean;
  banned_at: number | null;
  timed_out_until: number | null;
  suspension_reason: string | null;
  flagged_at: number | null;
  xp: number;
  equipped: Partial<Equipped>;
  name_changed_at: number | null;
};

export const USER_COLUMNS = `id, email, display_name, email_verified_at, password_hash <> '' as has_password, created_at, country, is_subscriber, early_supporter,
  is_moderator, is_bot, banned_at, timed_out_until, suspension_reason, flagged_at, xp, equipped, name_changed_at`;

export function toUser(r: Row): UserRow {
  return {
    id: String(r.id),
    email: String(r.email),
    display_name: String(r.display_name),
    email_verified_at: (r.email_verified_at as number | null) ?? null,
    has_password: bool(r.has_password),
    created_at: Number(r.created_at),
    country: (r.country as string | null) ?? null,
    is_subscriber: bool(r.is_subscriber),
    early_supporter: bool(r.early_supporter),
    is_moderator: bool(r.is_moderator),
    is_bot: bool(r.is_bot),
    banned_at: (r.banned_at as number | null) ?? null,
    timed_out_until: (r.timed_out_until as number | null) ?? null,
    suspension_reason: (r.suspension_reason as string | null) ?? null,
    flagged_at: (r.flagged_at as number | null) ?? null,
    xp: Number(r.xp ?? 0),
    equipped: json(r.equipped, {}),
    name_changed_at: (r.name_changed_at as number | null) ?? null,
  };
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const r = await one(`select ${USER_COLUMNS} from users where id = ?`, id);
  return r ? toUser(r) : undefined;
}

/** Why a moderator action keeps this user out of matchmaking, or null if nothing does. */
export function suspension(u: Pick<UserRow, "banned_at" | "timed_out_until" | "suspension_reason">): string | null {
  const why = u.suspension_reason ? ` Reason: ${u.suspension_reason}` : "";
  if (u.banned_at) return `This account is banned.${why}`;
  if (u.timed_out_until && u.timed_out_until > Date.now()) {
    return `You're timed out from ranked and casual until ${new Date(u.timed_out_until).toUTCString()}.${why}`;
  }
  return null;
}

export const rankedMinAgeHours = () => Number(env.RANKED_MIN_ACCOUNT_AGE_HOURS ?? 24);

/** Why this user can't queue for ranked, or null if they can. */
export function rankedBlock(u: UserRow): string | null {
  const suspended = suspension(u);
  if (suspended) return suspended;
  if (!u.email_verified_at) return "Verify your email to play ranked.";
  const min = rankedMinAgeHours();
  const ageH = (Date.now() - u.created_at) / 3600_000;
  if (min > 0 && ageH < min) {
    const left = Math.ceil(min - ageH);
    return `Ranked unlocks when your account is ${min}h old (${left}h to go). Casual is open now!`;
  }
  return null;
}

// ------------------------------------------------------------------ cosmetics
/** Cosmetic ids the user has unlocked. */
export async function unlockedCosmetics(u: Pick<UserRow, "id" | "xp" | "is_subscriber">): Promise<Set<string>> {
  const granted = await all<{ cosmetic_id: string }>("select cosmetic_id from user_cosmetics where user_id = ?", u.id);
  const level = levelFromXp(u.xp).level;
  const out = new Set(granted.map((g) => g.cosmetic_id));
  for (const c of COSMETICS) {
    const r = c.unlock;
    if (r.type === "default" || (r.type === "level" && level >= r.level) || (r.type === "subscriber" && u.is_subscriber)) {
      out.add(c.id);
    }
  }
  return out;
}

/** Tier cosmetics earned by reaching this rating. */
export function tierCosmeticIds(peak: number): string[] {
  const reached = tierIndex(tierFor(peak).id);
  return COSMETICS.filter((c) => c.unlock.type === "tier" && tierIndex(c.unlock.tier) <= reached).map((c) => c.id);
}

// ------------------------------------------------------------------ public bits
export type PublicProfileBits = {
  id: string;
  name: string;
  level: number;
  caretColor: string;
  caretShape: string;
  banner: string;
  subscriber: boolean;
  rating: number;
  races: number;
};

export async function playerBits(userId: string, user?: UserRow): Promise<PublicProfileBits | undefined> {
  const u = user ?? (await getUser(userId));
  if (!u) return undefined;
  const season = await currentSeason();
  const r = await getRating(userId, season.id);
  const eq = resolveEquipped(u.equipped);
  return {
    id: u.id,
    name: u.display_name,
    level: levelFromXp(u.xp).level,
    caretColor: eq.caretColor,
    caretShape: eq.caretShape,
    banner: eq.banner,
    subscriber: u.is_subscriber,
    rating: Math.round(r.rating),
    races: r.races,
  };
}

// ------------------------------------------------------------------ friends
/** Ids of the user's accepted friends. */
export async function friendIds(userId: string): Promise<string[]> {
  const rows = await all<{ id: string }>(
    `select addressee_id id from friendships where requester_id = ?1 and status = 'accepted'
     union all select requester_id from friendships where addressee_id = ?1 and status = 'accepted'`,
    userId,
  );
  return rows.map((r) => r.id);
}

/** Which of `others` are accepted friends of the user. */
export async function friendsAmong(userId: string, others: string[]): Promise<Set<string>> {
  const ids = [...new Set(others.filter(isUuid))].slice(0, 100);
  if (!ids.length) return new Set();
  const rows = await all<{ id: string }>(
    `select addressee_id id from friendships where requester_id = ? and status = 'accepted' and addressee_id in (${marks(ids.length)})
     union all
     select requester_id from friendships where addressee_id = ? and status = 'accepted' and requester_id in (${marks(ids.length)})`,
    userId,
    ...ids,
    userId,
    ...ids,
  );
  return new Set(rows.map((r) => r.id));
}
