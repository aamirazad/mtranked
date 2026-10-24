// Funbox modes, ported from monkeytype (packages/funbox + frontend/src/ts/test/funbox).
// This module is the single list of funbox ids and their metadata, plus every
// funbox that changes the text or the typing rules. Those run here so the
// browser and the race server generate identical text from a seed. Purely
// visual funboxes are implemented in the frontend (frontend/src/lib/funbox).
//
// Funboxes are never used in ranked or casual matchmaking: only practice and
// private rooms.

export const FUNBOX_IDS = [
  // visual (client only)
  "mirror",
  "upside_down",
  "nausea",
  "round_round_baby",
  "choo_choo",
  "earthquake",
  "space_balls",
  "crt",
  "simon_says",
  "tts",
  "read_ahead_easy",
  "read_ahead",
  "read_ahead_hard",
  "memory",
  "blind",
  "plus_zero",
  "plus_one",
  "plus_two",
  "plus_three",
  "layout_mirror",
  "no_quit",
  // text / typing rules (shared with the server)
  "58008",
  "arrows",
  "gibberish",
  "ascii",
  "specials",
  "binary",
  "hexadecimal",
  "pseudolang",
  "polyglot",
  "zipf",
  "rAnDoMcAsE",
  "sPoNgEcAsE",
  "capitals",
  "ALL_CAPS",
  "instant_messaging",
  "rot13",
  "backwards",
  "ddoouubblleedd",
  "morse",
  "underscore_spaces",
  "nospace",
] as const;
export type FunboxId = (typeof FUNBOX_IDS)[number];

export type FunboxKind = "visual" | "text";

/** Same property names as monkeytype, used by the compatibility rules. */
type FunboxProperty =
  | "ignoresLanguage"
  | "ignoresLayout"
  | "usesLayout"
  | "changesLayout"
  | "noLetters"
  | "nospace"
  | "changesWordsVisibility"
  | "changesWordsFrequency"
  | "changesCapitalization"
  | "conflictsWithSymmetricChars"
  | "symmetricChars"
  | "speaks"
  | "unspeakable"
  | "toPush"
  | "wordOrder";

type FunboxFn = "getWord" | "withWords" | "punctuateWord" | "getEmulatedChar" | "alterText";
/** what a visual funbox restyles; two funboxes may not restyle the same thing */
type CssSlot = "typingArea" | "letters" | "body";

export type FunboxMeta = {
  id: FunboxId;
  name: string;
  description: string;
  kind: FunboxKind;
  props?: FunboxProperty[];
  fns?: FunboxFn[];
  css?: CssSlot[];
  /** forces punctuation and/or numbers off */
  forcesOff?: ("punctuation" | "numbers")[];
  /** only changes the text in words/time mode (quotes and custom text keep their words) */
  wordsOnly?: boolean;
};

const META: FunboxMeta[] = [
  { id: "mirror", name: "mirror", description: "Everything is mirrored!", kind: "visual", css: ["typingArea"] },
  {
    id: "upside_down",
    name: "upside down",
    description: "Everything is upside down!",
    kind: "visual",
    css: ["typingArea"],
  },
  { id: "nausea", name: "nausea", description: "I think I'm gonna be sick.", kind: "visual", css: ["typingArea"] },
  {
    id: "round_round_baby",
    name: "round round baby",
    description: "...right round, like a record baby. Right, round round round.",
    kind: "visual",
    css: ["typingArea"],
  },
  {
    id: "choo_choo",
    name: "choo choo",
    description: "All the letters are spinning!",
    kind: "visual",
    css: ["letters"],
    props: ["conflictsWithSymmetricChars"],
  },
  {
    id: "earthquake",
    name: "earthquake",
    description: "Everybody get down! The words are shaking!",
    kind: "visual",
    css: ["letters"],
  },
  {
    id: "space_balls",
    name: "space balls",
    description: "In a galaxy far far away.",
    kind: "visual",
    css: ["body", "typingArea"],
  },
  { id: "crt", name: "crt", description: "Go back to the 1980s.", kind: "visual", css: ["body"] },
  {
    id: "simon_says",
    name: "simon says",
    description: "Type what simon says. Only the next key is shown.",
    kind: "visual",
    props: ["changesWordsVisibility", "usesLayout"],
  },
  {
    id: "tts",
    name: "tts",
    description: "Listen closely. Words are read out loud.",
    kind: "visual",
    props: ["changesWordsVisibility", "speaks"],
  },
  {
    id: "read_ahead_easy",
    name: "read ahead easy",
    description: "Only the current word is invisible.",
    kind: "visual",
    props: ["changesWordsVisibility"],
  },
  {
    id: "read_ahead",
    name: "read ahead",
    description: "Current and the next word are invisible!",
    kind: "visual",
    props: ["changesWordsVisibility"],
  },
  {
    id: "read_ahead_hard",
    name: "read ahead hard",
    description: "Current and the next two words are invisible!",
    kind: "visual",
    props: ["changesWordsVisibility"],
  },
  {
    id: "memory",
    name: "memory",
    description: "Test your memory. The words vanish once you start typing (or when the timer runs out).",
    kind: "visual",
    props: ["changesWordsVisibility"],
  },
  { id: "blind", name: "blind", description: "Mistakes are not shown. Trust your fingers.", kind: "visual" },
  {
    id: "plus_zero",
    name: "plus zero",
    description: "React quickly! Only the current word is visible.",
    kind: "visual",
    props: ["changesWordsVisibility", "toPush"],
  },
  {
    id: "plus_one",
    name: "plus one",
    description: "Only one future word is visible.",
    kind: "visual",
    props: ["changesWordsVisibility", "toPush"],
  },
  {
    id: "plus_two",
    name: "plus two",
    description: "Only two future words are visible.",
    kind: "visual",
    props: ["changesWordsVisibility", "toPush"],
  },
  {
    id: "plus_three",
    name: "plus three",
    description: "Only three future words are visible.",
    kind: "visual",
    props: ["changesWordsVisibility", "toPush"],
  },
  {
    id: "layout_mirror",
    name: "layout mirror",
    description: "Mirror the (qwerty) keyboard layout: q types p, a types ;",
    kind: "visual",
    props: ["changesLayout"],
  },
  { id: "no_quit", name: "no quit", description: "You can't restart the test (practice).", kind: "visual" },

  {
    id: "58008",
    name: "58008",
    description: "A special mode for accountants. Enter works as space.",
    kind: "text",
    props: ["ignoresLanguage", "ignoresLayout", "noLetters"],
    fns: ["getWord", "punctuateWord", "getEmulatedChar"],
    forcesOff: ["numbers"],
    wordsOnly: true,
  },
  {
    id: "arrows",
    name: "arrows",
    description: "Play it on a pad! Arrow keys, wasd or ijkl.",
    kind: "text",
    props: ["ignoresLanguage", "ignoresLayout", "nospace", "noLetters", "symmetricChars"],
    fns: ["getWord", "getEmulatedChar"],
    forcesOff: ["punctuation", "numbers"],
    wordsOnly: true,
  },
  {
    id: "gibberish",
    name: "gibberish",
    description: "Anvbuefl dizzs eoos alsb?",
    kind: "text",
    props: ["ignoresLanguage", "unspeakable"],
    fns: ["getWord"],
    wordsOnly: true,
  },
  {
    id: "ascii",
    name: "ascii",
    description: "Where was the ampersand again? Only ASCII characters.",
    kind: "text",
    props: ["ignoresLanguage", "noLetters", "unspeakable"],
    fns: ["getWord"],
    forcesOff: ["punctuation", "numbers"],
    wordsOnly: true,
  },
  {
    id: "specials",
    name: "specials",
    description: "!@#$%^&*. Only special characters.",
    kind: "text",
    props: ["ignoresLanguage", "noLetters", "unspeakable"],
    fns: ["getWord"],
    forcesOff: ["punctuation", "numbers"],
    wordsOnly: true,
  },
  {
    id: "binary",
    name: "binary",
    description: "01000010 01100101 01100101 01110000",
    kind: "text",
    props: ["ignoresLanguage", "ignoresLayout", "noLetters"],
    fns: ["getWord"],
    forcesOff: ["punctuation", "numbers"],
    wordsOnly: true,
  },
  {
    id: "hexadecimal",
    name: "hexadecimal",
    description: "0x38 0x20 0x74 0x69 0x6D 0x65 0x73",
    kind: "text",
    props: ["ignoresLanguage", "ignoresLayout", "noLetters"],
    fns: ["getWord", "punctuateWord"],
    forcesOff: ["numbers"],
    wordsOnly: true,
  },
  {
    id: "pseudolang",
    name: "pseudolang",
    description: "Nonsense words that look like the current language.",
    kind: "text",
    props: ["unspeakable", "ignoresLanguage"],
    fns: ["withWords"],
    wordsOnly: true,
  },
  {
    id: "polyglot",
    name: "polyglot",
    description: "Words from English, Spanish, French, German, Portuguese, Italian and Dutch in one test.",
    kind: "text",
    props: ["ignoresLanguage"],
    fns: ["withWords"],
    wordsOnly: true,
  },
  {
    id: "zipf",
    name: "zipf",
    description: "Words are picked according to Zipf's law: common words come up a lot more.",
    kind: "text",
    props: ["changesWordsFrequency"],
    wordsOnly: true,
  },
  {
    id: "rAnDoMcAsE",
    name: "rAnDoMcAsE",
    description: "raNdomIze ThE CApitaLizatIon Of EveRY LeTtEr.",
    kind: "text",
    props: ["changesCapitalization"],
    fns: ["alterText"],
  },
  {
    id: "sPoNgEcAsE",
    name: "sPoNgEcAsE",
    description: "I kInDa LiKe HoW iNeFfIcIeNt QwErTy Is.",
    kind: "text",
    props: ["changesCapitalization"],
    fns: ["alterText"],
  },
  {
    id: "capitals",
    name: "capitals",
    description: "Capitalize Every Word.",
    kind: "text",
    props: ["changesCapitalization"],
    fns: ["alterText"],
  },
  {
    id: "ALL_CAPS",
    name: "ALL CAPS",
    description: "WHY ARE WE SHOUTING?",
    kind: "text",
    props: ["changesCapitalization"],
    fns: ["alterText"],
  },
  {
    id: "instant_messaging",
    name: "instant messaging",
    description: "who needs shift anyway",
    kind: "text",
    props: ["changesCapitalization"],
    fns: ["alterText"],
  },
  {
    id: "rot13",
    name: "rot13",
    description: "Vg znl abg or frpher, ohg vg vf sha gb glcr!",
    kind: "text",
    fns: ["alterText"],
  },
  {
    id: "backwards",
    name: "backwards",
    description: "...sdrawkcab epyt ot yrt woN",
    kind: "text",
    props: ["conflictsWithSymmetricChars", "wordOrder"],
    fns: ["alterText"],
  },
  {
    id: "ddoouubblleedd",
    name: "ddoouubblleedd",
    description: "TTyyppee eevveerryytthhiinngg ttwwiiccee..",
    kind: "text",
    fns: ["alterText"],
  },
  {
    id: "morse",
    name: "morse",
    description: "-.../././.--./ -.../---/---/.--./-.-.--/",
    kind: "text",
    props: ["ignoresLanguage", "ignoresLayout", "noLetters", "nospace"],
    fns: ["alterText"],
  },
  {
    id: "underscore_spaces",
    name: "underscore spaces",
    description: "Underscores_are_better.",
    kind: "text",
    props: ["ignoresLanguage", "ignoresLayout", "nospace"],
    fns: ["alterText"],
  },
  {
    id: "nospace",
    name: "nospace",
    description: "Whoneedsspacesanyway? The next word starts on its own.",
    kind: "text",
    props: ["nospace"],
  },
];

export const FUNBOXES: Readonly<Record<FunboxId, FunboxMeta>> = Object.fromEntries(
  META.map((m) => [m.id, m]),
) as Record<FunboxId, FunboxMeta>;
export const FUNBOX_LIST: readonly FunboxMeta[] = META;

export const isFunboxId = (id: unknown): id is FunboxId => typeof id === "string" && id in FUNBOXES;

const has = (f: FunboxMeta, p: FunboxProperty) => f.props?.includes(p) ?? false;
const hasFn = (f: FunboxMeta, fn: FunboxFn) => f.fns?.includes(fn) ?? false;

/**
 * Whether these funboxes (plus `adding`) can be active together. Port of
 * monkeytype's checkCompatibility (packages/funbox/src/validation.ts).
 */
export function checkFunboxCompatibility(ids: readonly string[], adding?: string): boolean {
  const all = adding === undefined ? [...ids] : [...ids, adding];
  if (!all.every(isFunboxId)) return false;
  if (new Set(all).size !== all.length) return false;
  const fbs = all.map((id) => FUNBOXES[id as FunboxId]);
  const count = (pred: (f: FunboxMeta) => boolean) => fbs.filter(pred).length;
  const none = (pred: (f: FunboxMeta) => boolean) => count(pred) === 0;

  const cssCounts: Record<string, number> = {};
  for (const f of fbs) for (const c of f.css ?? []) cssCounts[c] = (cssCounts[c] ?? 0) + 1;

  return (
    count((f) => hasFn(f, "getWord") || hasFn(f, "withWords")) <= 1 &&
    count((f) => has(f, "wordOrder")) <= 1 &&
    (none((f) => has(f, "changesLayout")) || none((f) => has(f, "ignoresLayout") || has(f, "usesLayout"))) &&
    count((f) => has(f, "nospace") || has(f, "toPush")) <= 1 &&
    count((f) => has(f, "changesWordsVisibility")) <= 1 &&
    count((f) => has(f, "changesWordsFrequency")) <= 1 &&
    (none((f) => has(f, "changesWordsFrequency")) || none((f) => has(f, "ignoresLanguage"))) &&
    (none((f) => has(f, "noLetters")) || none((f) => has(f, "changesCapitalization"))) &&
    (none((f) => has(f, "conflictsWithSymmetricChars")) || none((f) => has(f, "symmetricChars"))) &&
    count((f) => has(f, "speaks")) <= 1 &&
    (none((f) => has(f, "speaks")) || none((f) => has(f, "unspeakable"))) &&
    count((f) => hasFn(f, "punctuateWord")) <= 1 &&
    count((f) => hasFn(f, "getEmulatedChar") || has(f, "changesLayout")) <= 1 &&
    count((f) => has(f, "changesCapitalization")) <= 1 &&
    Object.values(cssCounts).every((c) => c <= 1)
  );
}

/** Known ids only, no duplicates, and each one compatible with those before it. */
export function sanitizeFunbox(ids: readonly unknown[] | undefined): FunboxId[] {
  const out: FunboxId[] = [];
  for (const id of ids ?? []) {
    if (out.length >= 8) break;
    if (isFunboxId(id) && !out.includes(id) && checkFunboxCompatibility(out, id)) out.push(id);
  }
  return out;
}

/** Settings with a cleaned-up funbox list, or with funbox removed entirely (matchmaking). */
export function withFunbox<T extends { funbox?: FunboxId[] }>(settings: T, allowed: boolean): T {
  const { funbox, ...rest } = settings;
  const clean = allowed ? sanitizeFunbox(funbox) : [];
  return (clean.length ? { ...rest, funbox: clean } : rest) as T;
}

export const funboxActive = (ids: readonly string[] | undefined, id: FunboxId) => !!ids?.includes(id);

/** Typing-rule changes the engine (and the server's replay) must know about. */
export type TypingOptions = { nospace?: boolean };
export function funboxTypingOptions(ids: readonly string[] | undefined): TypingOptions {
  const nospace = (ids ?? []).some((id) => isFunboxId(id) && has(FUNBOXES[id], "nospace"));
  return nospace ? { nospace } : {};
}

// ------------------------------------------------------------------ text generation

type Rand = () => number;
const randInt = (rand: Rand, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pickFrom = <T>(rand: Rand, arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;

/** A replacement for "pick a random word from the language" in words/time mode. */
export type WordSource = {
  pick: (rand: Rand, i: number) => string;
  punctuate?: (rand: Rand, word: string) => string;
};

function numbersWord(rand: Rand, maxLen: number) {
  const len = randInt(rand, 1, maxLen);
  let s = "";
  for (let i = 0; i < len; i++) s += String(i === 0 ? randInt(rand, 1, 9) : randInt(rand, 0, 9));
  return s;
}

const SPECIALS = [..."`~!@#$%^&*()-_=+{}[]'\"/\\|?;:><,."];

function replaceCharAt(s: string, i: number, c: string) {
  return s.slice(0, i) + c + s.slice(i + 1);
}

/** monkeytype's DDR step generator (from Mirin's "Queue" modfile), on a seeded rng. */
function arrowsSource(): WordSource {
  let footTrack = false;
  let currFacing = 0;
  let facingCount = 0;
  let lastLeftStep = 0;
  let lastRightStep = 3;
  let leftStepCount = 0;
  let rightStepCount = 0;
  const step = (rand: Rand, override: boolean) => {
    facingCount--;
    let randomStep = Math.round(rand());
    let stepValue = Math.round(rand() * 5 - 0.5);
    if (override) {
      footTrack = Boolean(Math.round(rand()));
      stepValue = footTrack ? 3 : 0;
    } else {
      if (footTrack) {
        if (lastLeftStep === randomStep) leftStepCount++;
        else leftStepCount = 0;
        if (leftStepCount > 1 || (rightStepCount > 0 && leftStepCount > 0)) {
          randomStep = 1 - randomStep;
          leftStepCount = 0;
        }
        lastLeftStep = randomStep;
        stepValue = randomStep * (currFacing + 1);
      } else {
        if (lastRightStep === randomStep) rightStepCount++;
        else rightStepCount = 0;
        if (rightStepCount > 1 || (rightStepCount > 0 && leftStepCount > 0)) {
          randomStep = 1 - randomStep;
          rightStepCount = 0;
        }
        lastRightStep = randomStep;
        stepValue = 3 - randomStep * (currFacing + 1);
      }
      footTrack = !footTrack;
      if (facingCount < 0 && randomStep === 0) {
        currFacing = 1 - currFacing;
        facingCount = Math.floor(rand() * 3) + 3;
      }
    }
    return stepValue;
  };
  const arrows = ["←", "↓", "↑", "→"];
  return {
    pick: (rand, i) => {
      let m = "";
      for (let j = 0; j < 4; j++) m += arrows[Math.max(0, Math.min(3, step(rand, j === 0 && i === 0)))];
      return m;
    },
  };
}

/** Character n-gram model of a word list (monkeytype's pseudolang). */
function pseudolangSource(pool: string[]): WordSource {
  const PREFIX = 2;
  const ngrams = new Map<string, { chars: string[]; counts: number[]; total: number }>();
  for (const w of pool) {
    let prefix = "";
    for (const c of [...w, " "]) {
      let d = ngrams.get(prefix);
      if (!d) ngrams.set(prefix, (d = { chars: [], counts: [], total: 0 }));
      const k = d.chars.indexOf(c);
      if (k === -1) {
        d.chars.push(c);
        d.counts.push(1);
      } else d.counts[k]!++;
      d.total++;
      prefix = [...(prefix + c)].slice(-PREFIX).join("");
    }
  }
  return {
    pick: (rand) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        let word = "";
        for (let guard = 0; guard < 30; guard++) {
          const d = ngrams.get([...word].slice(-PREFIX).join(""));
          if (!d) break;
          let r = Math.floor(rand() * d.total);
          let k = 0;
          while (r >= d.counts[k]!) r -= d.counts[k++]!;
          const c = d.chars[k]!;
          if (c === " ") break;
          word += c;
        }
        if (word) return word;
      }
      return pickFrom(rand, pool);
    },
  };
}

/** Index following Zipf's law (monkeytype's zipfyRandomArrayIndex). */
function zipfIndex(rand: Rand, n: number) {
  const gamma = 0.5772156649015329;
  const H = Math.log(n + 0.5) + gamma;
  return Math.min(n - 1, Math.max(0, Math.floor(Math.exp(rand() * H - gamma) - 0.5)));
}

/** The word source for words/time mode, if a funbox replaces the language's words. */
export function funboxWordSource(
  ids: readonly string[] | undefined,
  pool: string[],
  polyglot?: string[][],
): WordSource | undefined {
  const on = (id: FunboxId) => funboxActive(ids, id);
  if (on("58008"))
    return {
      pick: (rand) => numbersWord(rand, 7),
      punctuate: (rand, word) => {
        if (word.length > 3) {
          if (rand() < 0.5) word = replaceCharAt(word, randInt(rand, 1, word.length - 2), ".");
          if (rand() < 0.75) {
            const i = randInt(rand, 1, word.length - 2);
            const special = pickFrom(rand, ["/", "*", "-", "+"]);
            if (word[i - 1] !== "." && word[i + 1] !== "." && word[i + 1] !== "0")
              word = replaceCharAt(word, i, special);
          }
        }
        return word;
      },
    };
  if (on("arrows")) return arrowsSource();
  if (on("gibberish"))
    return {
      pick: (rand) =>
        Array.from({ length: randInt(rand, 1, 7) }, () => String.fromCharCode(97 + randInt(rand, 0, 25))).join(""),
    };
  if (on("ascii"))
    return {
      pick: (rand) =>
        Array.from({ length: randInt(rand, 1, 10) }, () => String.fromCharCode(33 + randInt(rand, 0, 93))).join(""),
    };
  if (on("specials"))
    return { pick: (rand) => Array.from({ length: randInt(rand, 1, 7) }, () => pickFrom(rand, SPECIALS)).join("") };
  if (on("binary"))
    return {
      pick: (rand) =>
        Math.floor(rand() * 256)
          .toString(2)
          .padStart(8, "0"),
    };
  if (on("hexadecimal"))
    return {
      pick: (rand) =>
        Array.from({ length: randInt(rand, 1, 4) }, () =>
          Math.floor(rand() * 256)
            .toString(16)
            .padStart(2, "0"),
        ).join(""),
      punctuate: (_rand, word) => `0x${word}`,
    };
  if (on("pseudolang")) return pseudolangSource(pool);
  if (on("polyglot") && polyglot?.length) {
    const pools = polyglot.filter((p) => p.length);
    return { pick: (rand) => pickFrom(rand, pickFrom(rand, pools)) };
  }
  if (on("zipf")) return { pick: (rand) => pool[zipfIndex(rand, pool.length)]! };
  return undefined;
}

export const POLYGLOT_LANGUAGES = ["english", "spanish", "french", "german", "portuguese", "italian", "dutch"] as const;

/** Punctuation/numbers with the funbox's forced settings applied. */
export function funboxForcedOptions(
  ids: readonly string[] | undefined,
  opts: { punctuation: boolean; numbers: boolean },
) {
  const off = new Set((ids ?? []).flatMap((id) => (isFunboxId(id) ? (FUNBOXES[id].forcesOff ?? []) : [])));
  return { punctuation: opts.punctuation && !off.has("punctuation"), numbers: opts.numbers && !off.has("numbers") };
}

const MORSE: Record<string, string> = {
  a: ".-",
  b: "-...",
  c: "-.-.",
  d: "-..",
  e: ".",
  f: "..-.",
  g: "--.",
  h: "....",
  i: "..",
  j: ".---",
  k: "-.-",
  l: ".-..",
  m: "--",
  n: "-.",
  o: "---",
  p: ".--.",
  q: "--.-",
  r: ".-.",
  s: "...",
  t: "-",
  u: "..-",
  v: "...-",
  w: ".--",
  x: "-..-",
  y: "-.--",
  z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "'": ".----.",
  "/": "-..-.",
  "(": "-.--.",
  ")": "-.--.-",
  "&": ".-...",
  ":": "---...",
  ";": "-.-.-.",
  "=": "-...-",
  "+": ".-.-.",
  "-": "-....-",
  _: "..--.-",
  '"': ".-..-.",
  $: "...-..-",
  "!": "-.-.--",
  "@": ".--.-.",
};

const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

function rot13(word: string) {
  return word.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/**
 * Apply every text-altering funbox to the generated words, in list order.
 * Uses its own seeded rng so the text without these funboxes is unchanged.
 */
export function applyFunboxText(ids: readonly string[] | undefined, words: string[], rand: Rand): string[] {
  if (!ids?.length) return words;
  let out = words;
  for (const id of FUNBOX_IDS) {
    if (!ids.includes(id)) continue;
    switch (id) {
      case "rAnDoMcAsE":
        out = out.map((w) => [...w].map((c) => (rand() < 0.5 ? c.toUpperCase() : c.toLowerCase())).join(""));
        break;
      case "sPoNgEcAsE":
        out = out.map((w) => [...w].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(""));
        break;
      case "capitals":
        out = out.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
        break;
      case "ALL_CAPS":
        out = out.map((w) => w.toUpperCase());
        break;
      case "instant_messaging":
        out = out.map((w) =>
          w
            .toLowerCase()
            .replace(/[.!?]+$/g, "")
            .replace(/[().'"]/g, ""),
        );
        break;
      case "rot13":
        out = out.map(rot13);
        break;
      case "backwards":
        out = out.map((w) => [...w].reverse().join("")).reverse();
        break;
      case "ddoouubblleedd":
        out = out.map((w) => w.replace(/./gu, "$&$&"));
        break;
      case "morse":
        out = out.map((w) => [...deaccent(w).toLowerCase()].map((c) => (MORSE[c] ? `${MORSE[c]}/` : "")).join(""));
        break;
      case "underscore_spaces":
        out = out.map((w, i) => (i === out.length - 1 ? w : `${w}_`));
        break;
    }
    out = out.filter((w) => w.length > 0);
  }
  return out.length ? out : words;
}
