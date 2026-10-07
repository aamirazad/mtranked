import { describe, expect, it } from "vitest";
import { rate } from "./glicko2";

describe("glicko-2", () => {
  // worked example from Glickman's paper
  it("matches the reference example", () => {
    const r = rate({ rating: 1500, rd: 200, vol: 0.06 }, [
      { opponent: { rating: 1400, rd: 30, vol: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, vol: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, vol: 0.06 }, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
  });
});
