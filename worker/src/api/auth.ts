import { env } from "cloudflare:workers";
import { contract } from "@mtr/contracts";
import { OFFENSIVE_NAME_MESSAGE, isOffensiveName } from "@mtr/shared";
import {
  buildMe,
  clearSession,
  createSession,
  deleteSessionByToken,
  ensureGuest,
  getAuth,
  getGuest,
  hashPassword,
  issueTicket,
  promoteAdmin,
  verifyPassword,
} from "../auth";
import { all, batch, getUser, iso, one, q, run, suspension } from "../db";
import { newToken, randomInt, sha256, sign, unsign } from "../crypto";
import { rateLimit, type Http } from "../http";
import { codeEmail, resetEmail, verificationEmail } from "../mail";
import { flag } from "../stubs";
import { s, tooMany, unauth } from "./tsr";

const supporterSales = () => flag(env.SUPPORTER_SALES);

/**
 * Soft signal for moderators: a new account from an address a banned account used.
 * Never blocks the signup, since schools, offices and carrier NAT share addresses.
 */
async function flagPossibleBanEvader(userId: string, ip: string | null) {
  if (!ip) return;
  const banned = await all<{ id: string; display_name: string }>(
    `select id, display_name from users
     where banned_at is not null and id <> ?1
       and (signup_ip = ?2 or exists (select 1 from json_each(ban_ips) where value = ?2))
     order by banned_at desc limit 10`,
    userId,
    ip,
  );
  if (!banned.length) return;
  await run(
    "insert into flags (user_id, reason, details, created_at) values (?, 'possible_ban_evader', ?, ?)",
    userId,
    JSON.stringify({ banned: banned.map((b) => ({ id: b.id, name: b.display_name })) }),
    Date.now(),
  );
}

async function sendVerification(userId: string, email: string) {
  const token = newToken();
  // one live verification link per account: a new one replaces the last
  await batch([
    q("delete from email_tokens where user_id = ? and kind = 'verify'", userId),
    q(
      "insert into email_tokens (token_hash, user_id, kind, expires_at) values (?, ?, 'verify', ?)",
      await sha256(token),
      userId,
      Date.now() + 48 * 3600_000,
    ),
  ]);
  await verificationEmail(email, token);
}

/** Use a one-time email token: it's deleted as it's redeemed. */
async function redeemToken(token: string, kind: "verify" | "reset") {
  return one<{ user_id: string }>(
    "delete from email_tokens where token_hash = ? and kind = ? and expires_at > ? returning user_id",
    await sha256(token),
    kind,
    Date.now(),
  );
}

// ------------------------------------------------------------------ emailed sign-in codes
const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
/** how long an emailed code's proof of the address lasts while a new user picks a name */
const SIGNUP_TOKEN_MS = 30 * 60_000;
const BAD_CODE = { status: 400, body: { message: "That code is wrong or has expired.", fields: { code: "Wrong or expired code" } } } as const;

/** Email a fresh 6-digit code; it replaces any earlier one for the address. */
async function sendCode(email: string) {
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  await run(
    `insert into email_codes (email, code_hash, attempts, expires_at) values (?, ?, 0, ?)
     on conflict (email) do update set code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at`,
    email.toLowerCase(),
    await sha256(code),
    Date.now() + CODE_TTL_MS,
  );
  await codeEmail(email, code);
}

/** Use up a code: true if it was right. Wrong guesses count toward the code's limit. */
async function redeemCode(email: string, code: string) {
  const key = email.toLowerCase();
  const used = await one(
    "delete from email_codes where email = ? and code_hash = ? and expires_at > ? and attempts < ? returning email",
    key,
    await sha256(code),
    Date.now(),
    CODE_MAX_ATTEMPTS,
  );
  if (used) return true;
  await run("update email_codes set attempts = attempts + 1 where email = ?", key);
  return false;
}

/** Rate-limits code emails per sender and per address, so nobody can flood an inbox. */
async function canSendCode(h: Http, email: string) {
  return (await rateLimit("normal", `code:${h.ip}`)) && (await rateLimit("strict", `code:${email.toLowerCase()}`));
}

// ------------------------------------------------------------------ account creation
/** Create an account and sign it in. `passwordHash` is '' for code-only accounts. */
async function createAccount(h: Http, a: { email: string; passwordHash: string; displayName: string; verified: boolean }) {
  if (isOffensiveName(a.displayName)) {
    return { status: 400, body: { message: OFFENSIVE_NAME_MESSAGE, fields: { displayName: OFFENSIVE_NAME_MESSAGE } } } as const;
  }
  const taken = await all<{ email: string }>("select email from users where email = ? or display_name = ?", a.email, a.displayName);
  if (taken.some((t) => t.email.toLowerCase() === a.email.toLowerCase())) {
    return { status: 409, body: { message: "An account with this email already exists.", fields: { email: "Already registered" } } } as const;
  }
  if (taken.length) return { status: 409, body: { message: "That name is taken.", fields: { displayName: "Taken" } } } as const;
  const id = crypto.randomUUID();
  const free = !supporterSales();
  const now = Date.now();
  try {
    await run(
      `insert into users (id, email, password_hash, email_verified_at, display_name, created_at, signup_ip, early_supporter, is_subscriber)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      a.email,
      a.passwordHash,
      a.verified ? now : null,
      a.displayName,
      now,
      h.ip,
      free ? 1 : 0,
      free ? 1 : 0,
    );
  } catch (e) {
    // lost a race with another signup for the same email or name
    if (String(e).includes("UNIQUE")) return { status: 409, body: { message: "That email or name was just taken." } } as const;
    throw e;
  }
  await flagPossibleBanEvader(id, h.ip);
  if (a.verified) await promoteAdmin(id);
  else await sendVerification(id, a.email);
  await createSession(h, id);
  return { status: 200, body: { user: await buildMe((await getUser(id))!) } } as const;
}

export const authRouter = s.router(contract.auth, {
  me: async (_, { h }) => {
    const auth = await getAuth(h);
    if (auth) return { status: 200, body: { user: await buildMe(auth.user), guest: null, supporterSales: supporterSales() } };
    return { status: 200, body: { user: null, guest: await getGuest(h), supporterSales: supporterSales() } };
  },

  signup: async ({ body }, { h }) => {
    if (!(await rateLimit("strict", `signup:${h.ip}`))) return tooMany;
    // an emailed code proves the address; a password signup verifies it by link
    return createAccount(h, { email: body.email, passwordHash: await hashPassword(body.password), displayName: body.displayName, verified: false });
  },

  start: async ({ body }, { h }) => {
    if (!(await rateLimit("normal", `start:${h.ip}`))) return tooMany;
    const u = await one<{ password_hash: string; is_bot: number }>("select password_hash, is_bot from users where email = ?", body.email);
    if (!u) return { status: 200, body: { next: "new" } };
    if (u.password_hash || u.is_bot) return { status: 200, body: { next: "password" } };
    // a code-only account: send its code straight away
    if (!(await canSendCode(h, body.email))) return tooMany;
    await sendCode(body.email);
    return { status: 200, body: { next: "code" } };
  },

  sendCode: async ({ body }, { h }) => {
    if (!(await canSendCode(h, body.email))) return tooMany;
    const bot = await one("select 1 from users where email = ? and is_bot", body.email);
    if (!bot) await sendCode(body.email);
    return { status: 200, body: { ok: true } };
  },

  verifyCode: async ({ body }, { h }) => {
    if (!(await rateLimit("normal", `verify-code:${h.ip}`))) return tooMany;
    if (!(await redeemCode(body.email, body.code))) return BAD_CODE;
    const row = await one<{ id: string; is_bot: number; banned_at: number | null; suspension_reason: string | null }>(
      "select id, is_bot, banned_at, suspension_reason from users where email = ?",
      body.email,
    );
    if (!row) {
      // no account yet: the address is proven, so they only need to pick a name
      return { status: 200, body: { user: null, signupToken: await sign({ signupEmail: body.email }, SIGNUP_TOKEN_MS) } };
    }
    if (row.is_bot) return BAD_CODE;
    if (row.banned_at) return { status: 401, body: { message: suspension({ ...row, timed_out_until: null })! } };
    // signing in with a code proves the address
    await run("update users set email_verified_at = coalesce(email_verified_at, ?) where id = ?", Date.now(), row.id);
    await promoteAdmin(row.id);
    await createSession(h, row.id);
    return { status: 200, body: { user: await buildMe((await getUser(row.id))!), signupToken: null } };
  },

  signupWithCode: async ({ body }, { h }) => {
    if (!(await rateLimit("strict", `signup:${h.ip}`))) return tooMany;
    const t = await unsign<{ signupEmail?: unknown }>(body.signupToken);
    if (typeof t?.signupEmail !== "string") {
      return { status: 400, body: { message: "Your code expired. Go back and ask for a new one." } };
    }
    return createAccount(h, { email: t.signupEmail, passwordHash: "", displayName: body.displayName, verified: true });
  },

  setPassword: async ({ body }, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    if (!(await rateLimit("strict", `password:${auth.user.id}`))) return tooMany;
    if (auth.user.has_password) {
      const row = await one<{ password_hash: string }>("select password_hash from users where id = ?", auth.user.id);
      if (!body.current || !(await verifyPassword(row!.password_hash, body.current))) {
        return { status: 400, body: { message: "Your current password is wrong.", fields: { current: "Wrong password" } } };
      }
    }
    await batch([
      q("update users set password_hash = ? where id = ?", await hashPassword(body.password), auth.user.id),
      // changing a password signs out every other device; adding a first one doesn't need to
      ...(auth.user.has_password ? [q("delete from sessions where user_id = ? and id <> ?", auth.user.id, auth.sessionId)] : []),
    ]);
    return { status: 200, body: { user: await buildMe((await getUser(auth.user.id))!) } };
  },

  login: async ({ body }, { h }) => {
    if (!(await rateLimit("normal", `login:${h.ip}`)) || !(await rateLimit("strict", `login:${body.email.toLowerCase()}`))) {
      return tooMany;
    }
    const row = await one<{ id: string; password_hash: string; banned_at: number | null; suspension_reason: string | null }>(
      "select id, password_hash, banned_at, suspension_reason from users where email = ? and not is_bot",
      body.email,
    );
    // unknown emails still hash, so they take as long as real ones
    const valid = await verifyPassword(row?.password_hash ?? "!", body.password);
    if (!row || !valid) return { status: 401, body: { message: "Wrong email or password." } };
    if (row.banned_at) return { status: 401, body: { message: suspension({ ...row, timed_out_until: null })! } };
    await createSession(h, row.id);
    return { status: 200, body: { user: await buildMe((await getUser(row.id))!) } };
  },

  logout: async (_, { h }) => {
    await deleteSessionByToken(h);
    clearSession(h);
    return { status: 200, body: { ok: true } };
  },

  verify: async ({ body }) => {
    const t = await redeemToken(body.token, "verify");
    if (!t) return { status: 400, body: { message: "This link is invalid or has expired." } };
    await run("update users set email_verified_at = coalesce(email_verified_at, ?) where id = ?", Date.now(), t.user_id);
    await promoteAdmin(t.user_id);
    return { status: 200, body: { ok: true } };
  },

  resendVerification: async (_, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    if (!(await rateLimit("strict", `resend:${auth.user.id}`))) return tooMany;
    if (!auth.user.email_verified_at) await sendVerification(auth.user.id, auth.user.email);
    return { status: 200, body: { ok: true } };
  },

  forgot: async ({ body }, { h }) => {
    if (!(await rateLimit("strict", `forgot:${h.ip}`))) return tooMany;
    const u = await one<{ id: string; email: string }>("select id, email from users where email = ? and not is_bot", body.email);
    if (u) {
      const token = newToken();
      await batch([
        q("delete from email_tokens where user_id = ? and kind = 'reset'", u.id),
        q(
          "insert into email_tokens (token_hash, user_id, kind, expires_at) values (?, ?, 'reset', ?)",
          await sha256(token),
          u.id,
          Date.now() + 30 * 60_000,
        ),
      ]);
      await resetEmail(u.email, token);
    }
    // same response either way so emails can't be enumerated
    return { status: 200, body: { ok: true } };
  },

  reset: async ({ body }, { h }) => {
    if (!(await rateLimit("normal", `reset:${h.ip}`))) return tooMany;
    const t = await redeemToken(body.token, "reset");
    if (!t) return { status: 400, body: { message: "This reset link is invalid or has expired." } };
    await batch([
      q(
        "update users set password_hash = ?, email_verified_at = coalesce(email_verified_at, ?) where id = ?",
        await hashPassword(body.password),
        Date.now(),
        t.user_id,
      ),
      // a password reset signs out every device
      q("delete from sessions where user_id = ?", t.user_id),
    ]);
    await promoteAdmin(t.user_id);
    return { status: 200, body: { ok: true } };
  },

  sessions: async (_, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    const rows = await all<{ id: string; user_agent: string | null; ip: string | null; created_at: number; last_seen_at: number }>(
      `select id, user_agent, ip, created_at, last_seen_at from sessions
       where user_id = ? and expires_at > ? order by last_seen_at desc`,
      auth.user.id,
      Date.now(),
    );
    return {
      status: 200,
      body: {
        sessions: rows.map((r) => ({
          id: r.id,
          current: r.id === auth.sessionId,
          userAgent: r.user_agent,
          ip: r.ip,
          createdAt: iso(r.created_at),
          lastSeenAt: iso(r.last_seen_at),
        })),
      },
    };
  },

  revokeSession: async ({ params }, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return unauth;
    await run("delete from sessions where id = ? and user_id = ?", params.id, auth.user.id);
    if (params.id === auth.sessionId) clearSession(h);
    return { status: 200, body: { ok: true } };
  },

  ticket: async ({ body }, { h }) => {
    if (!(await rateLimit("loose", `ticket:${h.ip}`))) return tooMany;
    const auth = await getAuth(h);
    if (auth) return { status: 200, body: { ticket: await issueTicket({ kind: "user", userId: auth.user.id }) } };
    if (body.guestName && isOffensiveName(body.guestName)) {
      return { status: 400, body: { message: OFFENSIVE_NAME_MESSAGE, fields: { guestName: OFFENSIVE_NAME_MESSAGE } } };
    }
    const guest = await ensureGuest(h, body.guestName);
    return { status: 200, body: { ticket: await issueTicket({ kind: "guest", id: guest.id, name: guest.name }) } };
  },
});
