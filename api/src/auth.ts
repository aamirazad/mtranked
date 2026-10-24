import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { Request, Response } from "express";
import { sql, getUser, currentSeason, getRating, suspension, type UserRow } from "@mtr/db";
import { levelFromXp, DEFAULT_EQUIPPED, type Equipped } from "@mtr/shared";
import type { Me } from "@mtr/contracts";
import { env } from "./env";
import { redis } from "./redis";

export const SESSION_COOKIE = "mtr_session";
export const GUEST_COOKIE = "mtr_guest";
const SESSION_DAYS = 30;

// argon2id with OWASP-recommended parameters
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (p: string) => hash(p, ARGON);
export const verifyPassword = (h: string, p: string) => verify(h, p).catch(() => false);

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: env.prod,
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeMs,
});

export async function createSession(req: Request, res: Response, userId: string) {
  const token = newToken();
  await sql`insert into sessions (user_id, token_hash, expires_at, user_agent, ip)
    values (${userId}, ${sha256(token)}, now() + make_interval(days => ${SESSION_DAYS}),
      ${req.get("user-agent")?.slice(0, 300) ?? null}, ${req.ip ?? null})`;
  res.cookie(SESSION_COOKIE, token, cookieOpts(SESSION_DAYS * 86400_000));
}

export type Auth = { user: UserRow; sessionId: string };

/** Resolve the signed-in user from the session cookie (sliding expiry). */
export async function getAuth(req: Request, res?: Response): Promise<Auth | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length > 100) return null;
  const [s] = await sql<{ id: string; user_id: string; expires_at: Date }[]>`
    select id, user_id, expires_at from sessions where token_hash = ${sha256(token)} and expires_at > now()`;
  if (!s) return null;
  const user = await getUser(s.user_id);
  if (!user || user.banned_at) return null;
  // refresh when less than half the lifetime is left
  if (s.expires_at.getTime() - Date.now() < (SESSION_DAYS / 2) * 86400_000) {
    await sql`update sessions set expires_at = now() + make_interval(days => ${SESSION_DAYS}), last_seen_at = now() where id = ${s.id}`;
    res?.cookie(SESSION_COOKIE, token, cookieOpts(SESSION_DAYS * 86400_000));
  } else {
    sql`update sessions set last_seen_at = now() where id = ${s.id}`.catch(() => {});
  }
  return { user, sessionId: s.id };
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function deleteSessionByToken(req: Request) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") await sql`delete from sessions where token_hash = ${sha256(token)}`;
}

export function rankedBlock(u: UserRow): string | null {
  const suspended = suspension(u);
  if (suspended) return suspended;
  if (!u.email_verified_at) return "Verify your email to play ranked.";
  const ageH = (Date.now() - u.created_at.getTime()) / 3600_000;
  if (ageH < env.rankedMinAgeHours) {
    const left = Math.ceil(env.rankedMinAgeHours - ageH);
    return `Ranked unlocks when your account is ${env.rankedMinAgeHours}h old (${left}h to go). Casual is open now!`;
  }
  return null;
}

export const NAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** when the user may next change their display name, or null if they can now */
export function nextNameChange(u: UserRow): Date | null {
  if (!u.name_changed_at) return null;
  const at = new Date(u.name_changed_at.getTime() + NAME_CHANGE_COOLDOWN_MS);
  return at.getTime() > Date.now() ? at : null;
}

export async function buildMe(u: UserRow): Promise<Me> {
  const season = await currentSeason();
  const r = await getRating(u.id, season.id);
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    verified: !!u.email_verified_at,
    createdAt: u.created_at.toISOString(),
    country: u.country,
    subscriber: u.is_subscriber,
    earlySupporter: u.early_supporter,
    moderator: u.is_moderator,
    xp: u.xp,
    level: levelFromXp(u.xp).level,
    rating: Math.round(r.rating),
    rd: Math.round(r.rd),
    races: r.races,
    wins: r.wins,
    peak: Math.round(r.peak),
    equipped: { ...DEFAULT_EQUIPPED, ...(u.equipped as Partial<Equipped>) },
    rankedBlock: rankedBlock(u),
    suspended: suspension(u),
    nameChangeAt: nextNameChange(u)?.toISOString() ?? null,
  };
}

// ------------------------------------------------------------------ guests
export type GuestInfo = { id: string; name: string };

export async function getGuest(req: Request): Promise<GuestInfo | null> {
  const token = req.cookies?.[GUEST_COOKIE];
  if (typeof token !== "string" || token.length > 100) return null;
  const raw = await redis.get(`guest:${sha256(token)}`);
  return raw ? (JSON.parse(raw) as GuestInfo) : null;
}

export async function ensureGuest(req: Request, res: Response, name?: string): Promise<GuestInfo> {
  const existing = await getGuest(req);
  const token = existing ? (req.cookies[GUEST_COOKIE] as string) : newToken();
  const guest: GuestInfo = existing ?? {
    id: "g_" + randomBytes(8).toString("hex"),
    name: "guest" + Math.floor(1000 + Math.random() * 9000),
  };
  if (name) guest.name = name;
  await redis.set(`guest:${sha256(token)}`, JSON.stringify(guest), "EX", 30 * 86400);
  if (!existing) res.cookie(GUEST_COOKIE, token, cookieOpts(30 * 86400_000));
  return guest;
}

/** Short-lived single-use ticket the realtime server redeems on WebSocket connect. */
export async function issueTicket(
  payload: { kind: "user"; userId: string } | { kind: "guest"; id: string; name: string },
) {
  const ticket = newToken();
  await redis.set(`ticket:${ticket}`, JSON.stringify(payload), "EX", 60);
  return ticket;
}
