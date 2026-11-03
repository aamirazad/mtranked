// CPU-heavy work the API hands off. A free-plan Worker gets 10 ms of CPU per request; a Durable
// Object gets 30 s. Password hashing (PBKDF2) and scoring a practice test (text generation, which
// may parse the 1.9 MB quote list, plus a full keystroke replay) both need more than 10 ms.
// The API spreads calls over a few named instances (src/auth.ts) so they run in parallel.
import { DurableObject } from "cloudflare:workers";
import {
  LANGUAGES,
  applyKey,
  charStats,
  consistency,
  createState,
  finalStats,
  funboxTypingOptions,
  generateText,
  normalizeRules,
  raceTimeline,
  withFunbox,
  type Keystroke,
  type TextSettings,
} from "@mtr/engine";
import { SPEED_CEILING_WPM } from "@mtr/shared";
import { hashPasswordNow, verifyPasswordNow } from "./crypto";

export type PracticeScore =
  | { error: string }
  | {
      settings: TextSettings;
      plain: boolean;
      wpm: number;
      raw: number;
      acc: number;
      consistency: number;
      chars: [number, number, number, number];
      durationMs: number;
    };

export class Compute extends DurableObject<Env> {
  hashPassword(password: string) {
    return hashPasswordNow(password);
  }

  verifyPassword(hash: string, password: string) {
    return verifyPasswordNow(hash, password);
  }

  /**
   * Practice tests are scored like races: the text comes from the seed, the result from
   * replaying the keystrokes. Nothing the browser says about its own speed is used.
   */
  async scorePractice(rawSettings: TextSettings, seed: string, keys: Keystroke[]): Promise<PracticeScore> {
    // funbox and rules are cleaned the same way the Hub cleans room settings
    const { rules: rawRules, ...rest } = rawSettings;
    const rules = normalizeRules(rawRules);
    const settings = withFunbox<TextSettings>(rules ? { ...rest, rules } : rest, true);
    if (!(LANGUAGES as readonly string[]).includes(settings.language)) return { error: "Unknown language." };
    for (let i = 1; i < keys.length; i++) {
      if (keys[i]!.t < keys[i - 1]!.t) return { error: "Keystrokes out of order." };
    }

    const { text } = await generateText(settings, seed);
    const opts = funboxTypingOptions(settings.funbox);
    const st = createState(text, settings.rules, opts);
    const timed = settings.mode === "time";
    const limit = timed ? settings.time * 1000 : Infinity;
    let finishAt: number | null = null;
    const used: Keystroke[] = [];
    for (const k of keys) {
      if (k.t > limit) break;
      used.push(k);
      applyKey(st, k.k, k.t);
      if (st.failed) return { error: "That test was failed." };
      if (st.finished) {
        finishAt = k.t;
        break;
      }
    }
    if (!timed && finishAt === null) return { error: "That test wasn't finished." };
    const durationMs = Math.max(1, timed ? limit : finishAt!);
    const stats = finalStats(st, durationMs);
    if (stats.wpm > SPEED_CEILING_WPM) return { error: "That result looks impossible." };
    const timeline = raceTimeline(text, used, durationMs, settings.rules, opts);
    return {
      settings,
      /** plain tests (no funbox, no rules) are the only ones that count toward personal bests */
      plain: !settings.funbox && !settings.rules,
      wpm: stats.wpm,
      raw: stats.raw,
      acc: stats.acc,
      consistency: consistency(timeline),
      chars: charStats(st),
      durationMs: Math.round(durationMs),
    };
  }
}
