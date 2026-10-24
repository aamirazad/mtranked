// Result-screen statistics derived from a finished typing state or keystroke log,
// following monkeytype's definitions (characters, consistency, word bursts).
import {
  applyKey,
  calculateWpm,
  createState,
  BACKSPACE,
  WORD_DELETE,
  type Keystroke,
  type TimelinePoint,
  type TypingState,
} from "./typing";
import type { TypingOptions } from "./funbox";
import type { Rules } from "./rules";

/** [correct, incorrect, extra, missed], as on monkeytype's result screen. */
export type CharStats = [correct: number, incorrect: number, extra: number, missed: number];

/**
 * Character breakdown of the final input. Spaces after submitted words count as
 * correct; missed letters only count for words that were submitted.
 */
export function charStats(s: TypingState): CharStats {
  let correct = 0;
  let incorrect = 0;
  let extra = 0;
  let missed = 0;
  const last = Math.min(s.wi, s.words.length - 1);
  for (let i = 0; i <= last; i++) {
    const word = s.words[i]!;
    const input = s.inputs[i] ?? "";
    const n = Math.min(word.length, input.length);
    for (let j = 0; j < n; j++) {
      if (input[j] === word[j]) correct++;
      else incorrect++;
    }
    extra += Math.max(0, input.length - word.length);
    if (i < s.wi) {
      missed += Math.max(0, word.length - input.length);
      correct++; // the space
    }
  }
  return [correct, incorrect, extra, missed];
}

/** monkeytype's "kogasa" mapping of a coefficient of variation to 0-100. */
function kogasa(cov: number) {
  return 100 * (1 - Math.tanh(cov + cov ** 3 / 3 + cov ** 5 / 5));
}

/** Consistency (0-100) of the per-second raw speed: 100 means perfectly even typing. */
export function consistency(timeline: TimelinePoint[]): number {
  const raws = timeline.map((p) => p.raw);
  if (raws.length < 2) return raws.length ? 100 : 0;
  const mean = raws.reduce((a, b) => a + b, 0) / raws.length;
  if (mean <= 0) return 0;
  const sd = Math.sqrt(raws.reduce((a, b) => a + (b - mean) ** 2, 0) / raws.length);
  return Math.round(kogasa(sd / mean) * 100) / 100;
}

/** One word of the input history: target word, what was typed, burst speed in wpm. */
export type WordStat = { w: string; i: string; b: number };

/**
 * Per-word input history. A word's burst runs from the moment the previous word was
 * submitted (or the first key) to the moment this one was submitted (or finished).
 */
export function wordHistory(
  text: string,
  keys: Keystroke[],
  untilMs = Infinity,
  rules?: Rules,
  opts?: TypingOptions,
): WordStat[] {
  const s = createState(text, rules, opts);
  const startAt: number[] = [];
  const endAt: number[] = [];
  for (const ks of keys) {
    if (ks.t > untilMs) break;
    const wi = s.wi;
    startAt[wi] ??= ks.t;
    if (!applyKey(s, ks.k, ks.t)) continue;
    if (ks.k === BACKSPACE || ks.k === WORD_DELETE) {
      if (s.wi < wi) endAt.length = s.wi; // went back into the previous word
      continue;
    }
    if (s.wi > wi) {
      endAt[wi] = ks.t;
      startAt[s.wi] = ks.t;
    } else if (s.finished) endAt[wi] = ks.t;
  }
  const out: WordStat[] = [];
  const last = Math.min(s.wi, s.words.length - 1);
  for (let i = 0; i <= last; i++) {
    const input = s.inputs[i] ?? "";
    if (!input && i === last) break;
    const start = startAt[i];
    const end = endAt[i] ?? keys.findLast((k) => k.t <= untilMs)?.t;
    const chars = input.length + (i < s.wi && !s.nospace ? 1 : 0);
    const b =
      start !== undefined && end !== undefined && end > start ? Math.round(calculateWpm(chars, end - start)) : 0;
    out.push({ w: s.words[i]!, i: input, b });
  }
  return out;
}
