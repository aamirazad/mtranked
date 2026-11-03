import { env } from "cloudflare:workers";
import { levelFromXp, DEFAULT_EQUIPPED, type Equipped } from "@mtr/shared";
import type { Me } from "@mtr/contracts";
import { currentSeason, getRating, getUser, one, rankedBlock, run, suspension, type UserRow } from "./db";
import { newToken, randomHex, randomInt, sha256, sign, unsign } from "./crypto";
import { clearCookie, setCookie, type Http } from "./http";
import { compute } from "./stubs";

export const SESSION_COOKIE = "mtr_session";
export const GUEST_COOKIE = "mtr_guest";
const DAY = 86_400_000;
const SESSION_DAYS = 30;
/** last_seen_at is only rewritten this often, so browsing doesn't cost a row write per request */
const SEEN_EVERY_MS = 3600_000;

// ------------------------------------------------------------------ passwords (Compute DO)
export const hashPassword = (p: string) => compute().hashPassword(p);
export const verifyPassword = (h: string, p: string) => compute().verifyPassword(h, p);

// ------------------------------------------------------------------ sessions
export async function createSession(h: Http, userId: string) {
  const token = newToken();
  const now = Date.now();
  await run(
    `insert into sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent, ip)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    userId,
    await sha256(token),
    now,
    now,
    now + SESSION_DAYS * DAY,
    h.userAgent,
    h.ip,
  );
  setCookie(h, SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

export type Auth = { user: UserRow; sessionId: string };

/** Resolve the signed-in user from the session cookie (sliding expiry). */
export async function getAuth(h: Http): Promise<Auth | null> {
  const token = h.cookies[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const now = Date.now();
  const s = await one<{ id: string; user_id: string; expires_at: number; last_seen_at: number }>(
    "select id, user_id, expires_at, last_seen_at from sessions where token_hash = ? and expires_at > ?",
    await sha256(token),
    now,
  );
  if (!s) return null;
  const user = await getUser(s.user_id);
  if (!user || user.banned_at) return null;
  // refresh when less than half the lifetime is left
  if (s.expires_at - now < (SESSION_DAYS / 2) * DAY) {
    await run("update sessions set expires_at = ?, last_seen_at = ? where id = ?", now + SESSION_DAYS * DAY, now, s.id);
    setCookie(h, SESSION_COOKIE, token, SESSION_DAYS * 86400);
  } else if (now - s.last_seen_at > SEEN_EVERY_MS) {
    await run("update sessions set last_seen_at = ? where id = ?", now, s.id);
  }
  return { user, sessionId: s.id };
}

export const clearSession = (h: Http) => clearCookie(h, SESSION_COOKIE);

export async function deleteSessionByToken(h: Http) {
  const token = h.cookies[SESSION_COOKIE];
  if (token) await run("delete from sessions where token_hash = ?", await sha256(token));
}

export const NAME_CHANGE_COOLDOWN_MS = 30 * DAY;

/** when the user may next change their display name, or null if they can now */
export function nextNameChange(u: UserRow): Date | null {
  if (!u.name_changed_at) return null;
  const at = u.name_changed_at + NAME_CHANGE_COOLDOWN_MS;
  return at > Date.now() ? new Date(at) : null;
}

export async function buildMe(u: UserRow): Promise<Me> {
  const season = await currentSeason();
  const r = await getRating(u.id, season.id);
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    verified: !!u.email_verified_at,
    createdAt: new Date(u.created_at).toISOString(),
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

/** Accounts whose email is in ADMIN_EMAILS become moderators once that email is verified. */
export async function promoteAdmin(userId: string) {
  const admins = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) return;
  await run(
    `update users set is_moderator = 1 where id = ? and email_verified_at is not null and not is_moderator
       and lower(email) in (select value from json_each(?))`,
    userId,
    JSON.stringify(admins),
  );
}

// ------------------------------------------------------------------ guests
// A guest is a signed cookie, {id, name}: nothing is stored for them.
export type GuestInfo = { id: string; name: string };
const GUEST_DAYS = 30;

export async function getGuest(h: Http): Promise<GuestInfo | null> {
  const g = await unsign<GuestInfo>(h.cookies[GUEST_COOKIE]);
  return g && typeof g.id === "string" && typeof g.name === "string" ? { id: g.id, name: g.name } : null;
}

export async function ensureGuest(h: Http, name?: string): Promise<GuestInfo> {
  const existing = await getGuest(h);
  const guest: GuestInfo = existing ?? { id: "g_" + randomHex(8), name: "guest" + (1000 + randomInt(9000)) };
  if (name) guest.name = name;
  if (!existing || name) setCookie(h, GUEST_COOKIE, await sign(guest, GUEST_DAYS * DAY), GUEST_DAYS * 86400);
  return guest;
}

// ------------------------------------------------------------------ websocket tickets
export type Ticket = { kind: "user"; userId: string } | { kind: "guest"; id: string; name: string };

/** Short-lived signed ticket the Hub checks when the WebSocket connects. */
export const issueTicket = (t: Ticket) => sign(t, 60_000);
export const redeemTicket = (ticket: string | null) => unsign<Ticket>(ticket);
