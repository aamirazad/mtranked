import type { TierId } from "./tiers";

/** XP needed to go from level L to L+1. */
export const xpToNext = (level: number) => 100 + 25 * (level - 1);

export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = xp;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}

export function xpForRace(o: { wpm: number; won: boolean; finished: boolean; mode: string }): number {
  if (!o.finished) return 2;
  const base = 10 + Math.floor(o.wpm / 10);
  const win = o.won ? 15 : 0;
  const ranked = o.mode === "ranked" ? 5 : 0;
  return base + win + ranked;
}

export type CosmeticType = "caret_color" | "caret_shape" | "finish" | "banner";
export type UnlockRule =
  | { type: "default" }
  | { type: "level"; level: number }
  | { type: "tier"; tier: TierId }
  | { type: "subscriber" };

export type Cosmetic = {
  id: string;
  type: CosmeticType;
  name: string;
  /** colour, gradient or shape key, interpreted by the frontend */
  value: string;
  unlock: UnlockRule;
};

export const COSMETICS: Cosmetic[] = [
  // caret colours
  { id: "caret-gold", type: "caret_color", name: "Classic", value: "#e2b714", unlock: { type: "default" } },
  { id: "caret-mint", type: "caret_color", name: "Mint", value: "#5ce0a0", unlock: { type: "level", level: 3 } },
  { id: "caret-sky", type: "caret_color", name: "Sky", value: "#5cb8ff", unlock: { type: "level", level: 5 } },
  { id: "caret-rose", type: "caret_color", name: "Rose", value: "#ff6b9a", unlock: { type: "level", level: 8 } },
  { id: "caret-violet", type: "caret_color", name: "Violet", value: "#a78bfa", unlock: { type: "level", level: 12 } },
  { id: "caret-ember", type: "caret_color", name: "Ember", value: "#ff7a3d", unlock: { type: "level", level: 16 } },
  { id: "caret-platinum", type: "caret_color", name: "Platinum", value: "#4fd1c5", unlock: { type: "tier", tier: "platinum" } },
  { id: "caret-diamond", type: "caret_color", name: "Diamond", value: "#7aa2ff", unlock: { type: "tier", tier: "diamond" } },
  { id: "caret-master", type: "caret_color", name: "Master", value: "#d16bff", unlock: { type: "tier", tier: "master" } },
  { id: "caret-prism", type: "caret_color", name: "Prism", value: "prism", unlock: { type: "subscriber" } },
  // caret shapes
  { id: "shape-line", type: "caret_shape", name: "Line", value: "line", unlock: { type: "default" } },
  { id: "shape-block", type: "caret_shape", name: "Block", value: "block", unlock: { type: "level", level: 4 } },
  { id: "shape-underline", type: "caret_shape", name: "Underline", value: "underline", unlock: { type: "level", level: 7 } },
  { id: "shape-outline", type: "caret_shape", name: "Outline", value: "outline", unlock: { type: "level", level: 10 } },
  // finish animations
  { id: "finish-none", type: "finish", name: "None", value: "none", unlock: { type: "default" } },
  { id: "finish-confetti", type: "finish", name: "Confetti", value: "confetti", unlock: { type: "default" } },
  { id: "finish-fireworks", type: "finish", name: "Fireworks", value: "fireworks", unlock: { type: "level", level: 6 } },
  { id: "finish-stars", type: "finish", name: "Stars", value: "stars", unlock: { type: "level", level: 14 } },
  { id: "finish-gold", type: "finish", name: "Gold rain", value: "gold", unlock: { type: "subscriber" } },
  // banners
  { id: "banner-plain", type: "banner", name: "Plain", value: "linear-gradient(90deg,#2c2e31,#2c2e31)", unlock: { type: "default" } },
  { id: "banner-dusk", type: "banner", name: "Dusk", value: "linear-gradient(120deg,#3a2c4a,#2c2e31 60%)", unlock: { type: "level", level: 2 } },
  { id: "banner-ocean", type: "banner", name: "Ocean", value: "linear-gradient(120deg,#183a4f,#2c2e31 70%)", unlock: { type: "level", level: 9 } },
  { id: "banner-forest", type: "banner", name: "Forest", value: "linear-gradient(120deg,#1f3d2c,#2c2e31 70%)", unlock: { type: "level", level: 11 } },
  { id: "banner-gold", type: "banner", name: "Gilded", value: "linear-gradient(120deg,#5a4708,#2c2e31 70%)", unlock: { type: "tier", tier: "gold" } },
  { id: "banner-diamond", type: "banner", name: "Crystal", value: "linear-gradient(120deg,#26346b,#2c2e31 70%)", unlock: { type: "tier", tier: "diamond" } },
  { id: "banner-supporter", type: "banner", name: "Supporter", value: "linear-gradient(120deg,#e2b714 -40%,#7e2a33 30%,#2c2e31 80%)", unlock: { type: "subscriber" } },
];

export type Equipped = { caret_color: string; caret_shape: string; finish: string; banner: string };
export const DEFAULT_EQUIPPED: Equipped = {
  caret_color: "caret-gold",
  caret_shape: "shape-line",
  finish: "finish-confetti",
  banner: "banner-plain",
};

export const cosmeticById = (id: string) => COSMETICS.find((c) => c.id === id);

/** Resolve equipped ids to values, falling back to defaults. */
export function resolveEquipped(e: Partial<Equipped> | null | undefined) {
  const get = (k: keyof Equipped) =>
    (cosmeticById(e?.[k] ?? "") ?? cosmeticById(DEFAULT_EQUIPPED[k])!).value;
  return {
    caretColor: get("caret_color"),
    caretShape: get("caret_shape"),
    finish: get("finish"),
    banner: get("banner"),
  };
}
