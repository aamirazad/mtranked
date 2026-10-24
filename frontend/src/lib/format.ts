// Display formatting shared by the profile and result screens.

/** 12:04:09 (hours can exceed 24) */
export function hms(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type TestSettings = {
  mode: string;
  words?: number;
  time?: number;
  quoteLength?: string;
  language?: string;
  punctuation?: boolean;
  numbers?: boolean;
};

/** ["words 50", "english", "punctuation"] */
export function testType(s: TestSettings | null | undefined): string[] {
  if (!s) return [];
  const main =
    s.mode === "time"
      ? `time ${s.time}`
      : s.mode === "words"
        ? `words ${s.words}`
        : s.mode === "quote"
          ? `quote ${s.quoteLength}`
          : s.mode;
  const out = [main];
  if (s.language && s.mode !== "custom") out.push(s.language.replace("_", " "));
  if (s.punctuation) out.push("punctuation");
  if (s.numbers) out.push("numbers");
  return out;
}

export const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
