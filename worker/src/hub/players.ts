import type { PlayerPublic } from "@mtr/race-protocol";
import { resolveEquipped } from "@mtr/shared";
import { currentSeason, getRating, getUser, one, playerBits, rankedBlock as userRankedBlock, run, type UserRow } from "../db";

export type Identity = {
  id: string;
  guest: boolean;
  name: string;
  user?: UserRow;
};

const PLAIN_BANNER = resolveEquipped(null).banner;
/** Only a non-default banner is worth showing to others. */
export const showBanner = (banner?: string) => (banner && banner !== PLAIN_BANNER ? banner : undefined);

export async function publicInfo(idn: Identity): Promise<PlayerPublic> {
  if (idn.guest) {
    return { id: idn.id, name: idn.name, guest: true, level: 1, caretColor: "#e2b714", caretShape: "line", subscriber: false };
  }
  const b = await playerBits(idn.id, idn.user);
  return {
    id: idn.id,
    name: b?.name ?? idn.name,
    guest: false,
    level: b?.level ?? 1,
    caretColor: b?.caretColor ?? "#e2b714",
    caretShape: b?.caretShape ?? "line",
    banner: showBanner(b?.banner),
    subscriber: b?.subscriber ?? false,
    rating: b?.rating,
    races: b?.races,
  };
}

/** Why this identity can't queue for ranked, or null if it can (`fresh` re-reads the account). */
export async function rankedBlock(idn: Identity, fresh = true): Promise<string | null> {
  if (idn.guest) return "Sign in to play ranked.";
  const u = (fresh ? await getUser(idn.id) : idn.user) ?? idn.user;
  if (!u) return "Sign in to play ranked.";
  idn.user = u;
  return userRankedBlock(u);
}

export async function currentRating(userId: string) {
  const season = await currentSeason();
  return getRating(userId, season.id);
}

/** Soft signal: several ranked accounts from one signup IP get a flag (at most once a day, never a ban). */
export async function checkSharedIp(userId: string) {
  const now = Date.now();
  const recent = await one("select 1 from flags where user_id = ? and reason = 'shared_ip' and created_at > ?", userId, now - 86400_000);
  if (recent) return;
  const row = await one<{ n: number }>(
    `select count(distinct u2.id) n from users u1
    join users u2 on u2.signup_ip = u1.signup_ip and u2.id <> u1.id
    join ratings r on r.user_id = u2.id and r.races > 0
    where u1.id = ? and u1.signup_ip is not null`,
    userId,
  );
  if (row && row.n >= 1) {
    await run("insert into flags (user_id, reason, details, created_at) values (?, 'shared_ip', ?, ?)", userId, JSON.stringify({ others: row.n }), now);
  }
}
