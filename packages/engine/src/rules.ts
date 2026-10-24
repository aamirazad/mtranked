// Gameplay rules (monkeytype's "behavior" settings that change what counts).
// They are only fair when everyone racing shares them, so they exist in
// practice (per player) and in private rooms (set by the host). Ranked and
// casual always race with no rules. The engine applies them identically in
// the browser and on the server so both agree on every keystroke.

export const STOP_ON_ERROR = ["off", "letter", "word"] as const;
export const CONFIDENCE = ["off", "on", "max"] as const;
export const DIFFICULTY = ["normal", "expert", "master"] as const;

export type Rules = {
  /** letter: wrong letters aren't inserted; word: space won't move past a wrong word */
  stopOnError?: (typeof STOP_ON_ERROR)[number];
  /** on: no backspacing into the previous word; max: no backspace at all */
  confidence?: (typeof CONFIDENCE)[number];
  /** backspace into any previous word, even a correct one (ignored with confidence) */
  freedom?: boolean;
  /** space at the start of a word is typed as a (wrong) character instead of ignored */
  strictSpace?: boolean;
  /** expert: fail on submitting a wrong word; master: fail on any wrong key */
  difficulty?: (typeof DIFFICULTY)[number];
  /** accents are removed from the text (é → e) */
  lazy?: boolean;
  /** fail when net wpm drops below this (checked every second after the 4th word); 0 = off */
  minWpm?: number;
  /** fail when accuracy drops below this percentage (checked every second); 0 = off */
  minAcc?: number;
  /** fail when a word is typed slower than this wpm; 0 = off */
  minBurst?: number;
  /** scale the burst threshold down for long words (monkeytype's "flex") */
  burstFlex?: boolean;
};

export type FailReason = "min speed" | "min accuracy" | "min burst" | "difficulty";

export const MAX_MIN_WPM = 300;

/** Drop unknown/default values so equal rule sets compare equal and stay small on the wire. */
export function normalizeRules(r: Rules | undefined | null): Rules | undefined {
  if (!r) return undefined;
  const out: Rules = {};
  if (r.stopOnError && r.stopOnError !== "off" && STOP_ON_ERROR.includes(r.stopOnError))
    out.stopOnError = r.stopOnError;
  if (r.confidence && r.confidence !== "off" && CONFIDENCE.includes(r.confidence)) out.confidence = r.confidence;
  else if (r.freedom) out.freedom = true;
  if (r.strictSpace) out.strictSpace = true;
  if (r.difficulty && r.difficulty !== "normal" && DIFFICULTY.includes(r.difficulty)) out.difficulty = r.difficulty;
  if (r.lazy) out.lazy = true;
  const num = (v: unknown, max: number) => (typeof v === "number" && v > 0 ? Math.min(max, Math.round(v)) : 0);
  const minWpm = num(r.minWpm, MAX_MIN_WPM);
  const minAcc = num(r.minAcc, 100);
  const minBurst = num(r.minBurst, MAX_MIN_WPM);
  if (minWpm) out.minWpm = minWpm;
  if (minAcc) out.minAcc = minAcc;
  if (minBurst) {
    out.minBurst = minBurst;
    if (r.burstFlex) out.burstFlex = true;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Short labels for the active rules, e.g. ["stop on error: letter", "min 60 wpm"]. */
export function describeRules(r: Rules | undefined): string[] {
  const n = normalizeRules(r);
  if (!n) return [];
  const out: string[] = [];
  if (n.stopOnError) out.push(`stop on error: ${n.stopOnError}`);
  if (n.confidence) out.push(n.confidence === "max" ? "no backspace" : "confidence");
  if (n.freedom) out.push("freedom");
  if (n.strictSpace) out.push("strict space");
  if (n.difficulty) out.push(n.difficulty);
  if (n.lazy) out.push("lazy");
  if (n.minWpm) out.push(`min ${n.minWpm} wpm`);
  if (n.minAcc) out.push(`min ${n.minAcc}% acc`);
  if (n.minBurst) out.push(`min ${n.minBurst} burst${n.burstFlex ? " (flex)" : ""}`);
  return out;
}

/** monkeytype's flex burst threshold: easier for long words */
export function flexBurst(speed: number, wordLength: number): number {
  return Math.min(speed, Math.floor(speed * Math.pow(1.03, -2 * (wordLength - 3))));
}

/** Remove accents for lazy mode (é → e, ß → ss, æ → ae ...). */
export function stripAccents(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "Ae")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "Oe")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .normalize("NFC");
}
