import { initServer } from "@ts-rest/express";
import { contract } from "@mtr/contracts";
import { sql, intArray } from "@mtr/db";
import {
  LANGUAGES,
  charStats,
  consistency,
  createState,
  applyKey,
  funboxTypingOptions,
  normalizeRules,
  withFunbox,
  finalStats,
  generateText,
  raceTimeline,
  type Keystroke,
  type TextSettings,
} from "@mtr/engine";
import { SPEED_CEILING_WPM } from "@mtr/shared";
import { getAuth } from "../auth";
import { rateLimit } from "../redis";

const s = initServer();

/**
 * Practice tests are scored like races: the text comes from the seed, the result from
 * replaying the keystrokes. Nothing the browser says about its own speed is used.
 */
export const practiceRouter = s.router(contract.practice, {
  submit: async ({ body, req, res }) => {
    const auth = await getAuth(req, res);
    if (!auth) return { status: 401, body: { message: "Sign in to save practice results." } };
    if (!(await rateLimit(`practice:${auth.user.id}`, 40, 60))) {
      return { status: 429, body: { message: "Slow down a little." } };
    }
    // funbox and rules are cleaned the same way the realtime server cleans room settings
    const { rules: rawRules, ...rest } = body.settings as unknown as TextSettings;
    const rules = normalizeRules(rawRules);
    const settings = withFunbox<TextSettings>(rules ? { ...rest, rules } : rest, true);
    /** plain tests (no funbox, no rules) are the only ones that count toward personal bests */
    const plain = !settings.funbox && !settings.rules;
    if (!(LANGUAGES as readonly string[]).includes(settings.language)) {
      return { status: 400, body: { message: "Unknown language." } };
    }
    const keys: Keystroke[] = body.keys;
    for (let i = 1; i < keys.length; i++) {
      if (keys[i]!.t < keys[i - 1]!.t) return { status: 400, body: { message: "Keystrokes out of order." } };
    }

    const { text } = await generateText(settings, body.seed);
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
      if (st.failed) return { status: 400, body: { message: "That test was failed." } };
      if (st.finished) {
        finishAt = k.t;
        break;
      }
    }
    if (!timed && finishAt === null) return { status: 400, body: { message: "That test wasn't finished." } };
    const durationMs = Math.max(1, timed ? limit : finishAt!);
    const stats = finalStats(st, durationMs);
    if (stats.wpm > SPEED_CEILING_WPM) return { status: 400, body: { message: "That result looks impossible." } };
    const timeline = raceTimeline(text, used, durationMs, settings.rules, opts);
    const cons = consistency(timeline);
    const chars = charStats(st);

    // best wpm on exactly this test before this one
    const [prev] = !plain
      ? [null]
      : await sql`
      select max(wpm)::float8 best from practice_results
      where user_id = ${auth.user.id} and text_settings->>'mode' = ${settings.mode}
        and text_settings->'funbox' is null and text_settings->'rules' is null
        and text_settings->>'language' = ${settings.language}
        and (text_settings->>'punctuation')::boolean = ${settings.punctuation}
        and (text_settings->>'numbers')::boolean = ${settings.numbers}
        and ${
          settings.mode === "time"
            ? sql`text_settings->>'time' = ${String(settings.time)}`
            : settings.mode === "words"
              ? sql`text_settings->>'words' = ${String(settings.words)}`
              : sql`text_settings->>'quoteLength' = ${settings.quoteLength}`
        }`;

    await sql`insert into practice_results (user_id, text_settings, seed, wpm, raw, accuracy, consistency, chars, duration_ms)
      values (${auth.user.id}, ${sql.json(settings as Record<string, unknown> as never)}, ${body.seed}, ${stats.wpm}, ${stats.raw},
        ${stats.acc}, ${cons}, ${intArray(sql, chars)}, ${Math.round(durationMs)})`;

    return {
      status: 200,
      body: {
        result: {
          wpm: stats.wpm,
          raw: stats.raw,
          acc: stats.acc,
          consistency: cons,
          chars,
          durationMs: Math.round(durationMs),
          previousBest: prev?.best ?? null,
        },
      },
    };
  },
});
