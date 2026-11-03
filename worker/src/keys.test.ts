import { describe, expect, it } from "vitest";
import { packKeys, unpackKeys } from "./keys";

describe("replay packing", () => {
  it("round-trips keystrokes, backspaces included", () => {
    const keys = [
      { k: "h", t: 120 },
      { k: "x", t: 250 },
      { k: "\b", t: 400 },
      { k: "i", t: 400 },
      { k: " ", t: 1310 },
    ];
    expect(unpackKeys(packKeys(keys))).toEqual(keys);
  });

  it("stores times as deltas", () => {
    expect(packKeys([{ k: "a", t: 1000 }, { k: "b", t: 1100 }])).toBe('[["a",1000],["b",100]]');
  });
});
