import { describe, expect, it } from "vitest";
import { isOffensiveName } from "./profanity";

describe("isOffensiveName", () => {
  it("flags profanity, including leetspeak and spelled-out letters", () => {
    for (const name of [
      "fuck",
      "FUCKKKK",
      "fvck",
      "sh1t",
      "b1tch",
      "a55hole",
      "n1gger",
      "cumslut",
      "f_u_c_k",
      "c.u.n.t",
      "s-h-i-t",
    ]) {
      expect(isOffensiveName(name), name).toBe(true);
    }
  });

  it("allows ordinary names that naive substring filters block", () => {
    for (const name of [
      "Scunthorpe",
      "assassin",
      "classic",
      "grapist",
      "therapist",
      "cocktail",
      "Dickens",
      "Sussex",
      "analysis",
      "assessment",
      "button",
      "skunk",
      "raccoon",
      "hello",
      "guest1234",
      "a_b_c",
      "my cool room",
    ]) {
      expect(isOffensiveName(name), name).toBe(false);
    }
  });
});
