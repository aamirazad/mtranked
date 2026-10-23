// Typing state machine shared by the browser (local rendering) and the race
// server (authoritative replay of the keystroke log). Behavior follows
// monkeytype's defaults: space submits a word even with mistakes, and you may
// backspace into the previous word only if it was typed incorrectly. Optional
// rules (see rules.ts) change that the same way on both sides.
import type { TypingOptions } from "./funbox";
import { flexBurst, normalizeRules, type FailReason, type Rules } from "./rules";

export const BACKSPACE = "\b";
/** ctrl/alt + backspace: delete the whole word */
export const WORD_DELETE = "\u0017";
const MAX_EXTRA = 20;

/** A single keystroke: inserted char, BACKSPACE or WORD_DELETE; t = ms since race start */
export type Keystroke = { k: string; t: number };

export type TypingState = {
  words: string[];
  /** word start offsets in the joined text */
  offsets: number[];
  textLength: number;
  inputs: string[];
  wi: number;
  finished: boolean;
  correctKeys: number;
  incorrectKeys: number;
  /** nospace funboxes: no space key, a word is submitted once it's as long as the target */
  nospace: boolean;
  rules: Rules;
  /** set once a rule fails the test; no more keys are accepted */
  failed: FailReason | null;
  /** when the current word was started (ms), for burst speed */
  burstStart: number | null;
  /** speed of the last submitted word */
  lastBurst: number | null;
};

export function createState(text: string, rules?: Rules, opts: TypingOptions = {}): TypingState {
  const words = text.split(" ");
  const offsets: number[] = [];
  let o = 0;
  for (const w of words) {
    offsets.push(o);
    o += w.length + 1;
  }
  return {
    words,
    offsets,
    textLength: text.length,
    inputs: [""],
    wi: 0,
    finished: false,
    correctKeys: 0,
    incorrectKeys: 0,
    nospace: !!opts.nospace,
    rules: normalizeRules(rules) ?? {},
    failed: null,
    burstStart: null,
    lastBurst: null,
  };
}

function fail(s: TypingState, reason: FailReason) {
  s.failed = reason;
  return true;
}

/**
 * Apply one key. Returns false if the key had no effect. `t` (ms) is the time
 * of the key; it is only needed for the min burst rule and burst stats.
 */
export function applyKey(s: TypingState, key: string, t?: number): boolean {
  if (s.finished || s.failed) return false;
  const r = s.rules;
  const word = s.words[s.wi]!;
  const input = s.inputs[s.wi] ?? "";
  const last = s.wi === s.words.length - 1;
  if (t !== undefined && s.burstStart === null) s.burstStart = t;

  if (key === BACKSPACE || key === WORD_DELETE) {
    if (r.confidence === "max") return false;
    if (input.length > 0) {
      s.inputs[s.wi] = key === BACKSPACE ? input.slice(0, -1) : "";
      return true;
    }
    const prevCorrect = s.inputs[s.wi - 1] === s.words[s.wi - 1];
    if (s.wi > 0 && r.confidence !== "on" && (r.freedom || !prevCorrect)) {
      s.inputs.pop();
      s.wi--;
      if (key === WORD_DELETE) s.inputs[s.wi] = "";
      return true;
    }
    return false;
  }

  // nospace funboxes: words submit themselves, the space key does nothing
  if (key === " " && s.nospace) return false;
  // strict space (and expert/master) types a leading space as a wrong letter
  const strict = r.strictSpace || r.difficulty !== undefined;
  if (key === " " && (input.length > 0 || !strict)) {
    if (input.length === 0) return false;
    if (input !== word) {
      s.incorrectKeys++;
      if (r.difficulty) return fail(s, "difficulty");
      // the race only ends when the final word is correct
      if (last) return false;
      // stop on error: the mistake counts, but you stay on the word
      if (r.stopOnError) return true;
    } else {
      if (last) {
        s.incorrectKeys++;
        return false;
      }
      s.correctKeys++;
    }
    let burstFail = false;
    if (t !== undefined && s.burstStart !== null) {
      const dt = t - s.burstStart;
      s.burstStart = t;
      if (dt > 0) {
        s.lastBurst = Math.round((input.length * (60000 / dt)) / 5);
        const min = r.minBurst ? (r.burstFlex ? flexBurst(r.minBurst, word.length) : r.minBurst) : 0;
        burstFail = min > 0 && s.lastBurst < min;
      }
    }
    s.wi++;
    s.inputs[s.wi] = "";
    if (burstFail) fail(s, "min burst");
    return true;
  }

  if (key.length !== 1) return false;
  if (input.length >= word.length + (s.nospace ? 0 : MAX_EXTRA)) return false;
  if (word[input.length] === key) s.correctKeys++;
  else {
    s.incorrectKeys++;
    if (r.difficulty === "master") return fail(s, "difficulty");
    // the mistake counts but nothing is typed
    if (r.stopOnError === "letter") return true;
  }
  s.inputs[s.wi] = input + key;
  if (last && s.inputs[s.wi] === word) s.finished = true;
  else if (s.nospace && !last && input.length + 1 === word.length) {
    s.wi++;
    s.inputs[s.wi] = "";
  }
  return true;
}

/**
 * Time-based fail rules (min speed, min accuracy), checked once per elapsed
 * second like monkeytype's timer. Sets and returns `failed`.
 */
export function checkLiveFail(s: TypingState, elapsedMs: number): FailReason | null {
  if (s.failed || s.finished) return s.failed;
  const r = s.rules;
  if (r.minWpm && s.wi > 3 && calculateWpm(correctChars(s, true), elapsedMs) < r.minWpm) s.failed = "min speed";
  else if (r.minAcc && accuracy(s) < r.minAcc) s.failed = "min accuracy";
  return s.failed;
}

/** Characters credited toward WPM: correct words plus their spaces (monkeytype's formula). */
export function correctChars(s: TypingState, creditPartial: boolean): number {
  let chars = 0;
  for (let i = 0; i < s.wi; i++) {
    if (s.inputs[i] === s.words[i]) chars += s.words[i]!.length + (s.nospace ? 0 : 1);
  }
  const word = s.words[s.wi]!;
  const input = s.inputs[s.wi] ?? "";
  if (s.finished) chars += word.length;
  else if (creditPartial && word.startsWith(input)) chars += input.length;
  return chars;
}

export function rawChars(s: TypingState): number {
  let chars = 0;
  for (let i = 0; i < s.wi; i++) chars += (s.inputs[i]?.length ?? 0) + (s.nospace ? 0 : 1);
  return chars + (s.inputs[s.wi]?.length ?? 0);
}

export function calculateWpm(chars: number, ms: number): number {
  if (ms <= 0) return 0;
  return chars / 5 / (ms / 60000);
}

export function accuracy(s: TypingState): number {
  const total = s.correctKeys + s.incorrectKeys;
  return total === 0 ? 100 : (s.correctKeys / total) * 100;
}

/** Caret position in the joined text (extra letters keep the caret at the word end). */
export function caretIndex(s: TypingState): number {
  if (s.finished) return s.textLength;
  const word = s.words[s.wi]!;
  return s.offsets[s.wi]! + Math.min((s.inputs[s.wi] ?? "").length, word.length);
}

/** Length of the correctly typed prefix of the text — used for ranking unfinished players. */
export function correctPrefix(s: TypingState): number {
  if (s.finished) return s.textLength;
  let n = 0;
  for (let i = 0; i < s.wi; i++) {
    if (s.inputs[i] !== s.words[i]) return n;
    n += s.words[i]!.length + 1;
  }
  const word = s.words[s.wi]!;
  const input = s.inputs[s.wi] ?? "";
  let j = 0;
  while (j < input.length && input[j] === word[j]) j++;
  return n + j;
}

export function replay(text: string, keys: Keystroke[], untilMs = Infinity, rules?: Rules, opts?: TypingOptions): TypingState {
  const s = createState(text, rules, opts);
  for (const ks of keys) {
    if (ks.t > untilMs) break;
    applyKey(s, ks.k, ks.t);
  }
  return s;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type FinalStats = { wpm: number; raw: number; acc: number; chars: number; prefix: number };

export function finalStats(s: TypingState, durationMs: number): FinalStats {
  const chars = correctChars(s, true);
  return {
    wpm: round2(calculateWpm(chars, durationMs)),
    raw: round2(calculateWpm(rawChars(s), durationMs)),
    acc: round2(accuracy(s)),
    chars,
    prefix: correctPrefix(s),
  };
}

/** One second of a race: net wpm so far, raw wpm within the second, mistakes within the second. */
export type TimelinePoint = { wpm: number; raw: number; err: number };

/** Per-second speed/mistake samples for the results graph (the last bucket may be partial). */
export function raceTimeline(text: string, keys: Keystroke[], durationMs: number, rules?: Rules, opts?: TypingOptions): TimelinePoint[] {
  const s = createState(text, rules, opts);
  const out: TimelinePoint[] = [];
  const buckets = Math.max(1, Math.ceil(durationMs / 1000));
  let i = 0;
  for (let b = 1; b <= buckets; b++) {
    const end = Math.min(b * 1000, durationMs);
    const errBefore = s.incorrectKeys;
    let typed = 0;
    while (i < keys.length && (keys[i]!.t <= end || b === buckets)) {
      const { k, t } = keys[i++]!;
      if (k !== BACKSPACE && k !== WORD_DELETE) typed++;
      applyKey(s, k, t);
    }
    const span = Math.max(1, end - (b - 1) * 1000);
    out.push({
      wpm: Math.round(calculateWpm(correctChars(s, true), Math.max(1, end))),
      raw: Math.round(calculateWpm(typed, span)),
      err: s.incorrectKeys - errBefore,
    });
  }
  return out;
}
