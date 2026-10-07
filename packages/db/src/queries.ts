import {
  COSMETICS,
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOL,
  levelFromXp,
  resolveEquipped,
  tierFor,
  tierIndex,
  PLACEMENT_RACES,
  type Equipped,
} from "@mtr/shared";
import { sql, type Sql } from "./client";

export type Season = { id: number; name: string; starts_at: Date; ends_at: Date; reset_params: { pull: number; rd: number } };

let seasonCache: { s: Season; at: number } | undefined;
export async function currentSeason(): Promise<Season> {
  if (seasonCache && Date.now() - seasonCache.at < 60_000 && seasonCache.s.ends_at.getTime() > Date.now()) {
    return seasonCache.s;
  }
  const [s] = await sql<Season[]>`
    select * from seasons where starts_at <= now() order by starts_at desc limit 1`;
  if (!s) throw new Error("No season configured. Run `pnpm db:seed`.");
  seasonCache = { s, at: Date.now() };
  return s;
}

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

export async function getRating(userId: string, seasonId: number, tx: Sql = sql): Promise<RatingRow> {
  const [r] = await tx<RatingRow[]>`
    select * from ratings where user_id = ${userId} and season_id = ${seasonId}`;
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

export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  email_verified_at: Date | null;
  created_at: Date;
  country: string | null;
  is_subscriber: boolean;
  is_moderator: boolean;
  is_bot: boolean;
  banned_at: Date | null;
  flagged_at: Date | null;
  xp: number;
  equipped: Partial<Equipped>;
};

export async function getUser(id: string): Promise<UserRow | undefined> {
  const [u] = await sql<UserRow[]>`
    select id, email, display_name, email_verified_at, created_at, country, is_subscriber,
      is_moderator, is_bot, banned_at, flagged_at, xp, equipped
    from users where id = ${id}`;
  return u;
}

/** Cosmetic ids the user has unlocked. */
export async function unlockedCosmetics(u: Pick<UserRow, "id" | "xp" | "is_subscriber">): Promise<Set<string>> {
  const granted = await sql<{ cosmetic_id: string }[]>`
    select cosmetic_id from user_cosmetics where user_id = ${u.id}`;
  const level = levelFromXp(u.xp).level;
  const out = new Set(granted.map((g) => g.cosmetic_id));
  for (const c of COSMETICS) {
    const r = c.unlock;
    if (
      r.type === "default" ||
      (r.type === "level" && level >= r.level) ||
      (r.type === "subscriber" && u.is_subscriber)
    ) {
      out.add(c.id);
    }
  }
  return out;
}

/** Grant tier cosmetics up to (and including) the given peak rating. */
export async function grantTierCosmetics(tx: Sql, userId: string, peak: number) {
  const reached = tierIndex(tierFor(peak).id);
  const ids = COSMETICS.filter((c) => c.unlock.type === "tier" && tierIndex(c.unlock.tier) <= reached).map(
    (c) => c.id,
  );
  for (const id of ids) {
    await tx`insert into user_cosmetics (user_id, cosmetic_id) values (${userId}, ${id}) on conflict do nothing`;
  }
}

export type PublicProfileBits = {
  id: string;
  name: string;
  level: number;
  caretColor: string;
  caretShape: string;
  subscriber: boolean;
  rating: number;
  races: number;
};

export async function playerBits(userId: string): Promise<PublicProfileBits | undefined> {
  const u = await getUser(userId);
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
    subscriber: u.is_subscriber,
    rating: Math.round(r.rating),
    races: r.races,
  };
}

export const isPlaced = (races: number) => races >= PLACEMENT_RACES;
