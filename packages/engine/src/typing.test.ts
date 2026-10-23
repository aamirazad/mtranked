import { describe, expect, it } from "vitest";
import {
  BACKSPACE,
  RANKED_SETTINGS,
  applyKey,
  caretIndex,
  checkLiveFail,
  createState,
  describeRules,
  finalStats,
  generateText,
  generateWords,
  normalizeRules,
  raceTimeline,
  replay,
  stripAccents,
} from "./index";

const typeStr = (s: ReturnType<typeof createState>, str: string) => {
  for (const c of str) applyKey(s, c);
};

describe("typing engine", () => {
  it("finishes only when the last word is correct", () => {
    const s = createState("hello world");
    typeStr(s, "hello worle");
    expect(s.finished).toBe(false);
    applyKey(s, BACKSPACE);
    applyKey(s, "d");
    expect(s.finished).toBe(true);
    expect(caretIndex(s)).toBe(11);
  });

  it("uses monkeytype's wpm formula (correct chars incl. spaces / 5 per minute)", () => {
    const s = replay("hello world", [..."hello world"].map((k, i) => ({ k, t: i * 100 })));
    const st = finalStats(s, 6000);
    expect(st.chars).toBe(11);
    expect(st.wpm).toBe(22);
    expect(st.acc).toBe(100);
  });

  it("can only go back into an incorrect previous word", () => {
    const s = createState("ab cd ef");
    typeStr(s, "ab ");
    applyKey(s, BACKSPACE);
    expect(s.wi).toBe(1);
    typeStr(s, "cx ");
    applyKey(s, BACKSPACE);
    expect(s.wi).toBe(1);
    expect(s.inputs[1]).toBe("cx");
  });

  it("generates identical words from the same seed", () => {
    const pool = ["a", "b", "c", "d", "e"];
    const o = { punctuation: true, numbers: true };
    expect(generateWords(pool, 30, "seed", o)).toEqual(generateWords(pool, 30, "seed", o));
  });
});

describe("race timeline", () => {
  it("samples net wpm, per-second raw wpm and mistakes", () => {
    // 11 chars in the first second (one wrong), the last one in the second
    const keys = [..."hellp"].map((k, i) => ({ k, t: i * 100 }));
    keys.push({ k: BACKSPACE, t: 500 }, ...[..."o worl"].map((k, i) => ({ k, t: 600 + i * 50 })));
    keys.push(...[..."d"].map((k) => ({ k, t: 1500 })));
    const tl = raceTimeline("hello world", keys, 1500);
    expect(tl).toHaveLength(2);
    expect(tl[0]!.err).toBe(1);
    expect(tl[1]!.err).toBe(0);
    expect(tl[0]!.raw).toBe(Math.round((11 / 5) * 60));
    expect(tl[1]!.wpm).toBe(Math.round((11 / 5) * (60000 / 1500)));
  });
});

describe("rules", () => {
  it("has no effect when empty (same as the default behavior)", () => {
    const a = createState("ab cd", {});
    const b = createState("ab cd");
    typeStr(a, "ax cd");
    typeStr(b, "ax cd");
    expect(a.inputs).toEqual(b.inputs);
    expect(a.rules).toEqual({});
  });

  it("stop on error letter: wrong letters count but aren't typed", () => {
    const s = createState("ab cd", { stopOnError: "letter" });
    typeStr(s, "axb ");
    expect(s.inputs[0]).toBe("ab");
    expect(s.wi).toBe(1);
    expect(s.incorrectKeys).toBe(1);
    // space on an incomplete word is a mistake and doesn't move on
    typeStr(s, "c ");
    expect(s.wi).toBe(1);
    expect(s.incorrectKeys).toBe(2);
    typeStr(s, "d");
    expect(s.finished).toBe(true);
  });

  it("stop on error word: can't leave a wrong word", () => {
    const s = createState("ab cd", { stopOnError: "word" });
    typeStr(s, "ax ");
    expect(s.wi).toBe(0);
    expect(s.inputs[0]).toBe("ax");
    applyKey(s, BACKSPACE);
    typeStr(s, "b ");
    expect(s.wi).toBe(1);
  });

  it("confidence on: no backspacing into the previous word; max: no backspace at all", () => {
    const on = createState("ab cd", { confidence: "on" });
    typeStr(on, "ax c");
    applyKey(on, BACKSPACE);
    applyKey(on, BACKSPACE);
    expect(on.wi).toBe(1);
    expect(on.inputs[1]).toBe("");
    const max = createState("ab cd", { confidence: "max" });
    typeStr(max, "ax");
    expect(applyKey(max, BACKSPACE)).toBe(false);
    expect(max.inputs[0]).toBe("ax");
  });

  it("freedom: backspace into a correct previous word", () => {
    const s = createState("ab cd", { freedom: true });
    typeStr(s, "ab ");
    applyKey(s, BACKSPACE);
    expect(s.wi).toBe(0);
    // confidence wins over freedom
    const c = createState("ab cd", { freedom: true, confidence: "on" });
    expect(c.rules.freedom).toBeUndefined();
  });

  it("strict space: a leading space is typed as a wrong letter", () => {
    const s = createState("ab cd", { strictSpace: true });
    applyKey(s, " ");
    expect(s.inputs[0]).toBe(" ");
    expect(s.incorrectKeys).toBe(1);
    const normal = createState("ab cd");
    expect(applyKey(normal, " ")).toBe(false);
  });

  it("expert fails on a wrong word, master on any wrong key", () => {
    const e = createState("ab cd", { difficulty: "expert" });
    typeStr(e, "ax");
    expect(e.failed).toBeNull();
    applyKey(e, " ");
    expect(e.failed).toBe("difficulty");
    expect(applyKey(e, "c")).toBe(false);
    const m = createState("ab cd", { difficulty: "master" });
    typeStr(m, "ax");
    expect(m.failed).toBe("difficulty");
  });

  it("min burst fails a slow word (fixed and flex)", () => {
    // 2 letters in 1000 ms = 24 wpm
    const s = createState("ab cd ef", { minBurst: 30 });
    applyKey(s, "a", 0);
    applyKey(s, "b", 500);
    applyKey(s, " ", 1000);
    expect(s.lastBurst).toBe(24);
    expect(s.failed).toBe("min burst");
    const ok = createState("ab cd ef", { minBurst: 20 });
    [..."ab "].forEach((k, i) => applyKey(ok, k, i * 500));
    expect(ok.failed).toBeNull();
    // long words get an easier threshold with flex
    const flex = createState("abcdefghij k", { minBurst: 30, burstFlex: true });
    [..."abcdefghij "].forEach((k, i) => applyKey(flex, k, i * 420));
    expect(flex.lastBurst).toBe(29);
    expect(flex.failed).toBeNull();
    // replay agrees with live typing
    const keys = [..."ab "].map((k, i) => ({ k, t: i * 500 }));
    expect(replay("ab cd ef", keys, Infinity, { minBurst: 30 }).failed).toBe("min burst");
  });

  it("min speed and min accuracy are checked against elapsed time", () => {
    const s = createState("a b c d e f g", { minWpm: 50 });
    typeStr(s, "a b c d e ");
    // 10 chars in 10 s = 12 wpm
    expect(checkLiveFail(s, 10_000)).toBe("min speed");
    const early = createState("a b c d e f g", { minWpm: 50 });
    typeStr(early, "a b ");
    // only after the 4th word
    expect(checkLiveFail(early, 10_000)).toBeNull();
    const acc = createState("abc def", { minAcc: 90 });
    typeStr(acc, "abx");
    expect(checkLiveFail(acc, 1000)).toBe("min accuracy");
  });

  it("lazy mode strips accents from generated text", async () => {
    expect(stripAccents("café straße Ærø")).toBe("cafe strasse Aero");
    const t = await generateText({ ...RANKED_SETTINGS, mode: "custom", custom: "déjà vu", rules: { lazy: true } }, "x");
    expect(t.text).toBe("deja vu");
  });

  it("normalizes rules and describes them", () => {
    expect(normalizeRules({ stopOnError: "off", minWpm: 0, confidence: "off" })).toBeUndefined();
    expect(normalizeRules({ minAcc: 150 })).toEqual({ minAcc: 100 });
    expect(describeRules({ stopOnError: "letter", minWpm: 60 })).toEqual(["stop on error: letter", "min 60 wpm"]);
  });

  it("timeline replays with the same rules", () => {
    const keys = [..."axb"].map((k, i) => ({ k, t: i * 100 }));
    const tl = raceTimeline("ab", keys, 300, { stopOnError: "letter" });
    expect(tl[0]!.err).toBe(1);
    expect(replay("ab", keys, Infinity, { stopOnError: "letter" }).finished).toBe(true);
  });
});
