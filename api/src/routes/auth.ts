import { initServer } from "@ts-rest/express";
import { contract } from "@mtr/contracts";
import { sql, getUser } from "@mtr/db";
import { EARLY_SUPPORTER_SIGNUPS } from "@mtr/shared";
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
  newToken,
  sha256,
  verifyPassword,
} from "../auth";
import { rateLimit } from "../redis";
import { resetEmail, verificationEmail } from "../mail";

const s = initServer();
const tooMany = { status: 429 as const, body: { message: "Too many attempts. Try again in a few minutes." } };

async function sendVerification(userId: string, email: string) {
  const token = newToken();
  await sql`insert into email_tokens (token_hash, user_id, kind, expires_at)
    values (${sha256(token)}, ${userId}, 'verify', now() + interval '48 hours')`;
  await verificationEmail(email, token);
}

// Pre-computed hash so failed logins for unknown emails take the same time.
const dummyHash = hashPassword("not-a-real-password");

export const authRouter = s.router(contract.auth, {
  me: async ({ req, res }) => {
    const auth = await getAuth(req, res);
    if (auth) return { status: 200, body: { user: await buildMe(auth.user), guest: null } };
    return { status: 200, body: { user: null, guest: await getGuest(req) } };
  },

  signup: async ({ body, req, res }) => {
    if (!(await rateLimit(`signup:${req.ip}`, 5, 600))) return tooMany;
    const taken = await sql`select email, display_name from users
      where email = ${body.email} or display_name = ${body.displayName}`;
    if (taken.some((t) => t.email.toLowerCase() === body.email.toLowerCase())) {
      return { status: 409, body: { message: "An account with this email already exists.", fields: { email: "Already registered" } } };
    }
    if (taken.length) return { status: 409, body: { message: "That name is taken.", fields: { displayName: "Taken" } } };
    const [u] = await sql<{ id: string }[]>`insert into users (email, password_hash, display_name, signup_ip, early_supporter, is_subscriber)
      values (${body.email}, ${await hashPassword(body.password)}, ${body.displayName}, ${req.ip ?? null},
        ${EARLY_SUPPORTER_SIGNUPS}, ${EARLY_SUPPORTER_SIGNUPS})
      returning id`;
    await sendVerification(u!.id, body.email);
    await createSession(req, res, u!.id);
    return { status: 200, body: { user: await buildMe((await getUser(u!.id))!) } };
  },

  login: async ({ body, req, res }) => {
    if (!(await rateLimit(`login:${req.ip}`, 10, 300)) || !(await rateLimit(`login:${body.email.toLowerCase()}`, 10, 300))) {
      return tooMany;
    }
    const [row] = await sql<{ id: string; password_hash: string; banned_at: Date | null }[]>`
      select id, password_hash, banned_at from users where email = ${body.email} and not is_bot`;
    const valid = row ? await verifyPassword(row.password_hash, body.password) : (await verifyPassword(await dummyHash, body.password), false);
    if (!row || !valid) return { status: 401, body: { message: "Wrong email or password." } };
    if (row.banned_at) return { status: 401, body: { message: "This account has been banned." } };
    await createSession(req, res, row.id);
    return { status: 200, body: { user: await buildMe((await getUser(row.id))!) } };
  },

  logout: async ({ req, res }) => {
    await deleteSessionByToken(req);
    clearSession(res);
    return { status: 200, body: { ok: true } };
  },

  verify: async ({ body }) => {
    const [t] = await sql<{ user_id: string }[]>`
      update email_tokens set used_at = now()
      where token_hash = ${sha256(body.token)} and kind = 'verify' and used_at is null and expires_at > now()
      returning user_id`;
    if (!t) return { status: 400, body: { message: "This link is invalid or has expired." } };
    await sql`update users set email_verified_at = coalesce(email_verified_at, now()) where id = ${t.user_id}`;
    return { status: 200, body: { ok: true } };
  },

  resendVerification: async ({ req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return { status: 401, body: { message: "Sign in first." } };
    if (!(await rateLimit(`resend:${auth.user.id}`, 3, 600))) return tooMany;
    if (!auth.user.email_verified_at) await sendVerification(auth.user.id, auth.user.email);
    return { status: 200, body: { ok: true } };
  },

  forgot: async ({ body, req }) => {
    if (!(await rateLimit(`forgot:${req.ip}`, 5, 600))) return tooMany;
    const [u] = await sql<{ id: string; email: string }[]>`select id, email from users where email = ${body.email} and not is_bot`;
    if (u) {
      const token = newToken();
      await sql`insert into email_tokens (token_hash, user_id, kind, expires_at)
        values (${sha256(token)}, ${u.id}, 'reset', now() + interval '30 minutes')`;
      await resetEmail(u.email, token);
    }
    // same response either way so emails can't be enumerated
    return { status: 200, body: { ok: true } };
  },

  reset: async ({ body, req }) => {
    if (!(await rateLimit(`reset:${req.ip}`, 10, 600))) return tooMany;
    const [t] = await sql<{ user_id: string }[]>`
      update email_tokens set used_at = now()
      where token_hash = ${sha256(body.token)} and kind = 'reset' and used_at is null and expires_at > now()
      returning user_id`;
    if (!t) return { status: 400, body: { message: "This reset link is invalid or has expired." } };
    await sql`update users set password_hash = ${await hashPassword(body.password)},
      email_verified_at = coalesce(email_verified_at, now()) where id = ${t.user_id}`;
    // a password reset signs out every device
    await sql`delete from sessions where user_id = ${t.user_id}`;
    return { status: 200, body: { ok: true } };
  },

  sessions: async ({ req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return { status: 401, body: { message: "Sign in first." } };
    const rows = await sql`select id, user_agent, ip, created_at, last_seen_at from sessions
      where user_id = ${auth.user.id} and expires_at > now() order by last_seen_at desc`;
    return {
      status: 200,
      body: {
        sessions: rows.map((r) => ({
          id: r.id,
          current: r.id === auth.sessionId,
          userAgent: r.user_agent,
          ip: r.ip,
          createdAt: r.created_at.toISOString(),
          lastSeenAt: r.last_seen_at.toISOString(),
        })),
      },
    };
  },

  revokeSession: async ({ req, res, params }) => {
    const auth = await getAuth(req, res);
    if (!auth) return { status: 401, body: { message: "Sign in first." } };
    await sql`delete from sessions where id = ${params.id} and user_id = ${auth.user.id}`;
    if (params.id === auth.sessionId) clearSession(res);
    return { status: 200, body: { ok: true } };
  },

  ticket: async ({ body, req, res }) => {
    if (!(await rateLimit(`ticket:${req.ip}`, 60, 60))) return tooMany;
    const auth = await getAuth(req, res);
    if (auth) return { status: 200, body: { ticket: await issueTicket({ kind: "user", userId: auth.user.id }) } };
    const guest = await ensureGuest(req, res, body.guestName);
    return { status: 200, body: { ticket: await issueTicket({ kind: "guest", id: guest.id, name: guest.name }) } };
  },
});
