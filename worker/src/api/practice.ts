import { contract } from "@mtr/contracts";
import type { Keystroke, TextSettings } from "@mtr/engine";
import { getAuth } from "../auth";
import { one, run } from "../db";
import { rateLimit } from "../http";
import { compute } from "../stubs";
import { s } from "./tsr";

export const practiceRouter = s.router(contract.practice, {
  submit: async ({ body }, { h }) => {
    const auth = await getAuth(h);
    if (!auth) return { status: 401, body: { message: "Sign in to save practice results." } };
    if (!(await rateLimit("normal", `practice:${auth.user.id}`))) {
      return { status: 429, body: { message: "Slow down a little." } };
    }
    // scored in the Compute Durable Object: replaying keystrokes can take more than a
    // free-plan Worker's 10 ms of CPU
    const score = await compute().scorePractice(
      body.settings as unknown as TextSettings,
      body.seed,
      body.keys as Keystroke[],
    );
    if ("error" in score) return { status: 400, body: { message: score.error } };
    const st = score.settings;

    // best wpm on exactly this test before this one
    const len = st.mode === "time" ? String(st.time) : st.mode === "words" ? String(st.words) : st.quoteLength;
    const prev = !score.plain
      ? null
      : await one<{ best: number | null }>(
          `select max(wpm) best from practice_results
          where user_id = ? and text_settings ->> '$.mode' = ?
            and text_settings ->> '$.funbox' is null and text_settings ->> '$.rules' is null
            and text_settings ->> '$.language' = ?
            and coalesce(text_settings ->> '$.punctuation', 0) = ? and coalesce(text_settings ->> '$.numbers', 0) = ?
            and cast(case text_settings ->> '$.mode' when 'time' then text_settings ->> '$.time'
                  when 'words' then text_settings ->> '$.words' else text_settings ->> '$.quoteLength' end as text) = ?`,
          auth.user.id,
          st.mode,
          st.language,
          st.punctuation ? 1 : 0,
          st.numbers ? 1 : 0,
          len,
        );

    await run(
      `insert into practice_results (user_id, text_settings, wpm, raw, accuracy, consistency, chars, duration_ms, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      auth.user.id,
      JSON.stringify(st),
      score.wpm,
      score.raw,
      score.acc,
      score.consistency,
      JSON.stringify(score.chars),
      score.durationMs,
      Date.now(),
    );

    return {
      status: 200,
      body: {
        result: {
          wpm: score.wpm,
          raw: score.raw,
          acc: score.acc,
          consistency: score.consistency,
          chars: score.chars as [number, number, number, number],
          durationMs: score.durationMs,
          previousBest: prev?.best ?? null,
        },
      },
    };
  },
});
