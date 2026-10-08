import { describe, expect, it } from "vitest";
import { BACKSPACE, applyKey, caretIndex, createState, finalStats, generateWords, raceTimeline, replay } from "./index";

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
