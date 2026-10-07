import { sql, playerBits, getUser, currentSeason, getRating, type UserRow } from "@mtr/db";
import type { PlayerPublic } from "@mtr/race-protocol";
import { redis } from "./redis";
import { env } from "./env";

export type Identity = {
  id: string;
  guest: boolean;
  name: string;
  user?: UserRow;
};

export async function redeemTicket(ticket: string): Promise<Identity | null> {
  if (!/^[\w-]{20,64}$/.test(ticket)) return null;
  const raw = await redis.getdel(`ticket:${ticket}`);
  if (!raw) return null;
  const t = JSON.parse(raw) as { kind: "user"; userId: string } | { kind: "guest"; id: string; name: string };
  if (t.kind === "guest") return { id: t.id, guest: true, name: t.name };
  const user = await getUser(t.userId);
  if (!user || user.banned_at) return null;
  return { id: user.id, guest: false, name: user.display_name, user };
}

export async function publicInfo(idn: Identity): Promise<PlayerPublic> {
  if (idn.guest) {
    return { id: idn.id, name: idn.name, guest: true, level: 1, caretColor: "#e2b714", caretShape: "line", subscriber: false };
  }
  const b = await playerBits(idn.id);
  return {
    id: idn.id,
    name: b?.name ?? idn.name,
    guest: false,
    level: b?.level ?? 1,
    caretColor: b?.caretColor ?? "#e2b714",
    caretShape: b?.caretShape ?? "line",
    subscriber: b?.subscriber ?? false,
    rating: b?.rating,
    races: b?.races,
  };
}

/** Why this identity can't queue for ranked, or null if it can. */
export async function rankedBlock(idn: Identity): Promise<string | null> {
  if (idn.guest || !idn.user) return "Sign in to play ranked.";
  const u = (await getUser(idn.id)) ?? idn.user;
  if (u.banned_at) return "This account is banned.";
  if (!u.email_verified_at) return "Verify your email to play ranked.";
  const ageH = (Date.now() - u.created_at.getTime()) / 3600_000;
  if (ageH < env.rankedMinAgeHours) return `Ranked unlocks when your account is ${env.rankedMinAgeHours}h old.`;
  return null;
}

export async function currentRating(userId: string) {
  const season = await currentSeason();
  return getRating(userId, season.id);
}

/** Soft signal: several ranked accounts from one signup IP get a flag (never an automatic ban). */
export async function checkSharedIp(userId: string) {
  const key = `ipcheck:${userId}`;
  if (await redis.exists(key)) return;
  await redis.set(key, "1", "EX", 86400);
  const [row] = await sql`
    select count(distinct u2.id)::int n from users u1
    join users u2 on u2.signup_ip = u1.signup_ip and u2.id <> u1.id
    join ratings r on r.user_id = u2.id and r.races > 0
    where u1.id = ${userId} and u1.signup_ip is not null`;
  if (row && row.n >= 1) {
    await sql`insert into flags (user_id, reason, details) values (${userId}, 'shared_ip', ${sql.json({ others: row.n })})`;
  }
}
