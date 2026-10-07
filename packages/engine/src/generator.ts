// Text generation, ported from monkeytype's words-generator (punctuation and
// number rules simplified to the languages we ship).
import { seededRandom } from "./rng";

export const LANGUAGES = [
  "english",
  "english_1k",
  "english_5k",
  "spanish",
  "french",
  "german",
  "portuguese",
  "italian",
  "dutch",
] as const;
export type LanguageId = (typeof LANGUAGES)[number];

export type Language = { name: string; words: string[] };
export type Quote = { t: string; s: string; id: number };

const languageLoaders: Record<LanguageId, () => Promise<{ default: Language }>> = {
  english: () => import("../data/languages/english.json"),
  english_1k: () => import("../data/languages/english_1k.json"),
  english_5k: () => import("../data/languages/english_5k.json"),
  spanish: () => import("../data/languages/spanish.json"),
  french: () => import("../data/languages/french.json"),
  german: () => import("../data/languages/german.json"),
  portuguese: () => import("../data/languages/portuguese.json"),
  italian: () => import("../data/languages/italian.json"),
  dutch: () => import("../data/languages/dutch.json"),
};

const langCache = new Map<string, Language>();
export async function loadLanguage(id: LanguageId): Promise<Language> {
  const cached = langCache.get(id);
  if (cached) return cached;
  const lang = (await (languageLoaders[id] ?? languageLoaders.english)()).default;
  langCache.set(id, lang);
  return lang;
}

let quotesCache: Quote[] | undefined;
export async function loadQuotes(): Promise<Quote[]> {
  quotesCache ??= (await import("../data/quotes/english.json")).default as Quote[];
  return quotesCache;
}

export const QUOTE_LENGTHS = { short: [0, 100], medium: [101, 300], long: [301, 600] } as const;
export type QuoteLength = keyof typeof QUOTE_LENGTHS;

export type TextSettings = {
  mode: "words" | "time" | "quote" | "custom";
  words: number;
  time: number;
  quoteLength: QuoteLength;
  punctuation: boolean;
  numbers: boolean;
  language: LanguageId;
  custom?: string;
};

export const RANKED_SETTINGS: TextSettings = {
  mode: "words",
  words: 50,
  time: 0,
  quoteLength: "short",
  punctuation: false,
  numbers: false,
  language: "english",
};

export function normalizeText(t: string): string {
  return t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function punctuate(rand: () => number, prev: string | undefined, word: string, i: number, n: number) {
  const lastChar = prev?.at(-1);
  if (i === 0 || (lastChar !== undefined && ".?!".includes(lastChar))) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  if ((rand() < 0.1 && lastChar !== "." && lastChar !== "," && i !== n - 2) || i === n - 1) {
    const r = rand();
    return word + (r <= 0.8 ? "." : r < 0.9 ? "?" : "!");
  }
  if (rand() < 0.01 && lastChar !== ",") return `"${word}"`;
  if (rand() < 0.011 && lastChar !== ",") return `'${word}'`;
  if (rand() < 0.012 && lastChar !== ",") return `(${word})`;
  if (rand() < 0.013) return word + ":";
  if (rand() < 0.014 && lastChar !== "-") return "-";
  if (rand() < 0.015) return word + ";";
  if (rand() < 0.2 && lastChar !== ",") return word + ",";
  return word;
}

function randomNumber(rand: () => number) {
  const len = 1 + Math.floor(rand() * 4);
  let s = String(1 + Math.floor(rand() * 9));
  for (let i = 1; i < len; i++) s += String(Math.floor(rand() * 10));
  return s;
}

export function generateWords(
  pool: string[],
  count: number,
  seed: string,
  opts: { punctuation: boolean; numbers: boolean },
): string[] {
  const rand = seededRandom(seed);
  const out: string[] = [];
  let prevRaw: string | undefined;
  for (let i = 0; i < count; i++) {
    let w: string;
    let tries = 0;
    // avoid the same word twice in a row (and the one before that)
    do {
      w = pool[Math.floor(rand() * pool.length)]!;
      tries++;
    } while (tries < 20 && (w === prevRaw || w === out[i - 2]));
    prevRaw = w;
    if (opts.numbers && rand() < 0.1) w = randomNumber(rand);
    if (opts.punctuation) w = punctuate(rand, out[i - 1], w, i, count);
    out.push(w);
  }
  return out;
}

/** Words to generate for a time-mode race: enough for ~240 wpm. */
export const wordsForTime = (seconds: number) => Math.max(30, Math.ceil(seconds * 4.5));

export type GeneratedText = { text: string; source?: string };

export async function generateText(settings: TextSettings, seed: string): Promise<GeneratedText> {
  if (settings.mode === "custom" && settings.custom) {
    return { text: normalizeText(settings.custom).slice(0, 5000) };
  }
  if (settings.mode === "quote") {
    const quotes = await loadQuotes();
    const [min, max] = QUOTE_LENGTHS[settings.quoteLength] ?? QUOTE_LENGTHS.short;
    const pool = quotes.filter((q) => q.t.length >= min && q.t.length <= max);
    const rand = seededRandom(seed);
    const q = pool[Math.floor(rand() * pool.length)]!;
    return { text: normalizeText(q.t), source: q.s };
  }
  const lang = await loadLanguage(settings.language);
  const count = settings.mode === "time" ? wordsForTime(settings.time) : settings.words;
  return {
    text: generateWords(lang.words, count, seed, settings).join(" "),
  };
}
