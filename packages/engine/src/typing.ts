// Typing state machine shared by the browser (local rendering) and the race
// server (authoritative replay of the keystroke log). Behaviour follows
// monkeytype's defaults: space submits a word even with mistakes, and you may
// backspace into the previous word only if it was typed incorrectly.

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
};

export function createState(text: string): TypingState {
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
  };
}

/** Apply one key. Returns false if the key had no effect. */
export function applyKey(s: TypingState, key: string): boolean {
  if (s.finished) return false;
  const word = s.words[s.wi]!;
  const input = s.inputs[s.wi] ?? "";
  const last = s.wi === s.words.length - 1;

  if (key === BACKSPACE || key === WORD_DELETE) {
    if (input.length > 0) {
      s.inputs[s.wi] = key === BACKSPACE ? input.slice(0, -1) : "";
      return true;
    }
    if (s.wi > 0 && s.inputs[s.wi - 1] !== s.words[s.wi - 1]) {
      s.inputs.pop();
      s.wi--;
      if (key === WORD_DELETE) s.inputs[s.wi] = "";
      return true;
    }
    return false;
  }

  if (key === " ") {
    if (input.length === 0) return false;
    if (last) {
      // the race only ends when the final word is correct
      s.incorrectKeys++;
      return false;
    }
    if (input === word) s.correctKeys++;
    else s.incorrectKeys++;
    s.wi++;
    s.inputs[s.wi] = "";
    return true;
  }

  if (key.length !== 1) return false;
  if (input.length >= word.length + MAX_EXTRA) return false;
  if (word[input.length] === key) s.correctKeys++;
  else s.incorrectKeys++;
  s.inputs[s.wi] = input + key;
  if (last && s.inputs[s.wi] === word) s.finished = true;
  return true;
}

/** Characters credited towards WPM: correct words plus their spaces (monkeytype's formula). */
export function correctChars(s: TypingState, creditPartial: boolean): number {
  let chars = 0;
  for (let i = 0; i < s.wi; i++) {
    if (s.inputs[i] === s.words[i]) chars += s.words[i]!.length + 1;
  }
  const word = s.words[s.wi]!;
  const input = s.inputs[s.wi] ?? "";
  if (s.finished) chars += word.length;
  else if (creditPartial && word.startsWith(input)) chars += input.length;
  return chars;
}

export function rawChars(s: TypingState): number {
  let chars = 0;
  for (let i = 0; i < s.wi; i++) chars += (s.inputs[i]?.length ?? 0) + 1;
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

export function replay(text: string, keys: Keystroke[], untilMs = Infinity): TypingState {
  const s = createState(text);
  for (const ks of keys) {
    if (ks.t > untilMs) break;
    applyKey(s, ks.k);
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
