import { describe, expect, it } from "vitest";
import { BACKSPACE, applyKey, caretIndex, createState, finalStats, generateWords, replay } from "./index";

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
