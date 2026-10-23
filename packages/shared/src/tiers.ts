export const TIERS = [
  { id: "bronze", name: "Bronze", min: -Infinity, color: "#c17f4a" },
  { id: "silver", name: "Silver", min: 1200, color: "#b8c2cc" },
  { id: "gold", name: "Gold", min: 1400, color: "#e2b714" },
  { id: "platinum", name: "Platinum", min: 1600, color: "#4fd1c5" },
  { id: "diamond", name: "Diamond", min: 1800, color: "#7aa2ff" },
  { id: "master", name: "Master", min: 2000, color: "#d16bff" },
] as const;

export type TierId = (typeof TIERS)[number]["id"];
export type Tier = (typeof TIERS)[number];

/** Ranked races needed before a tier is shown. */
export const PLACEMENT_RACES = 5;

export function tierFor(rating: number): Tier {
  let found: Tier = TIERS[0];
  for (const t of TIERS) if (rating >= t.min) found = t;
  return found;
}

export function tierById(id: string): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}

export function tierIndex(id: string): number {
  return TIERS.findIndex((t) => t.id === id);
}

/** Display info for a player's rating, honoring placements. */
export function rankLabel(rating: number, races: number): {
  placed: boolean;
  tier: Tier | null;
  label: string;
} {
  if (races < PLACEMENT_RACES) {
    return { placed: false, tier: null, label: `Unranked ${races}/${PLACEMENT_RACES}` };
  }
  const tier = tierFor(rating);
  return { placed: true, tier, label: tier.name };
}
