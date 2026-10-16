import { describe, expect, it } from "vitest";
import { BACKSPACE, charStats, consistency, replay, wordHistory } from "./index";

const keysOf = (str: string, step = 100) => [...str].map((k, i) => ({ k, t: i * step }));

describe("result stats", () => {
  it("breaks characters down into correct / incorrect / extra / missed", () => {
    // "helo" misses a letter, "worldd" has an extra, "foo" has a wrong letter
    const s = replay("hello world foo", keysOf("helo worldd fxo"));
    const [correct, incorrect, extra, missed] = charStats(s);
    expect(incorrect).toBe(2); // "helo" vs "hell" at index 3, "fxo"
    expect(extra).toBe(1);
    expect(missed).toBe(1);
    expect(correct).toBe(3 + 5 + 2 + 2); // h,e,l + world + f,o + 2 spaces
  });

  it("scores even typing as perfectly consistent", () => {
    expect(consistency([{ wpm: 80, raw: 80, err: 0 }, { wpm: 80, raw: 80, err: 0 }, { wpm: 80, raw: 80, err: 0 }])).toBe(100);
    const uneven = consistency([{ wpm: 80, raw: 20, err: 0 }, { wpm: 80, raw: 140, err: 0 }, { wpm: 80, raw: 60, err: 0 }]);
    expect(uneven).toBeGreaterThan(0);
    expect(uneven).toBeLessThan(70);
  });

  it("records each word's input and burst speed", () => {
    const keys = [...keysOf("ab cx"), { k: BACKSPACE, t: 500 }, { k: "d", t: 600 }];
    const h = wordHistory("ab cd", keys);
    expect(h.map((x) => [x.w, x.i])).toEqual([
      ["ab", "ab"],
      ["cd", "cd"],
    ]);
    // "ab " = 3 chars in 200ms
    expect(h[0]!.b).toBe(180);
    expect(h[1]!.b).toBeGreaterThan(0);
  });
});
