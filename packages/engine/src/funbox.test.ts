import { describe, expect, it } from "vitest";
import {
  FUNBOX_IDS,
  FUNBOX_LIST,
  applyKey,
  caretIndex,
  checkFunboxCompatibility,
  createState,
  finalStats,
  funboxTypingOptions,
  generateText,
  replay,
  sanitizeFunbox,
  withFunbox,
  type FunboxId,
  type TextSettings,
} from "./index";

const base: TextSettings = {
  mode: "words",
  words: 40,
  time: 0,
  quoteLength: "short",
  punctuation: false,
  numbers: false,
  language: "english",
};
const textFunboxes = FUNBOX_LIST.filter((f) => f.kind === "text").map((f) => f.id);

describe("funbox text generation", () => {
  it("leaves the text alone without (text) funboxes", async () => {
    const plain = await generateText(base, "s1");
    expect((await generateText({ ...base, funbox: [] }, "s1")).text).toBe(plain.text);
    expect((await generateText({ ...base, funbox: ["mirror", "nausea"] as never }, "s1")).text).toBe(plain.text);
  });

  for (const id of textFunboxes) {
    it(`${id} is deterministic from the seed in every mode`, async () => {
      for (const mode of ["words", "time", "quote"] as const) {
        for (const punctuation of [false, true]) {
          const s: TextSettings = { ...base, mode, time: 15, punctuation, numbers: punctuation, funbox: [id] };
          const a = await generateText(s, "seed-a");
          const b = await generateText(JSON.parse(JSON.stringify(s)) as TextSettings, "seed-a");
          expect(a.text).toBe(b.text);
          expect(a.text.length).toBeGreaterThan(0);
          expect(a.text).not.toMatch(/ {2}|^ | $/);
        }
      }
      const c = await generateText({ ...base, funbox: [id] }, "seed-b");
      const d = await generateText({ ...base, funbox: [id] }, "seed-c");
      if (!["capitals", "sPoNgEcAsE", "ALL_CAPS", "instant_messaging", "rot13", "backwards", "ddoouubblleedd", "morse", "underscore_spaces", "nospace"].includes(id)) {
        expect(c.text).not.toBe(d.text);
      }
    });
  }

  it("transforms words as described", async () => {
    const plain = (await generateText(base, "x")).text.split(" ");
    const gen = async (funbox: FunboxId[], s = base) => (await generateText({ ...s, funbox }, "x")).text.split(" ");
    expect(await gen(["ddoouubblleedd"])).toEqual(plain.map((w) => [...w].map((c) => c + c).join("")));
    expect(await gen(["backwards"])).toEqual(plain.map((w) => [...w].reverse().join("")).reverse());
    expect(await gen(["ALL_CAPS"])).toEqual(plain.map((w) => w.toUpperCase()));
    expect(await gen(["capitals"])).toEqual(plain.map((w) => w[0]!.toUpperCase() + w.slice(1)));
    expect((await gen(["rAnDoMcAsE"])).map((w) => w.toLowerCase())).toEqual(plain);
    const us = await gen(["underscore_spaces"]);
    expect(us.slice(0, -1).every((w) => w.endsWith("_"))).toBe(true);
    expect(us.at(-1)!.endsWith("_")).toBe(false);
    expect((await gen(["morse"])).every((w) => /^[.\-/]+$/.test(w))).toBe(true);
    expect((await gen(["arrows"])).every((w) => /^[←↓↑→]{4}$/.test(w))).toBe(true);
    expect((await gen(["58008"])).every((w) => /^[1-9][0-9]*$/.test(w))).toBe(true);
    expect((await gen(["binary"])).every((w) => /^[01]{8}$/.test(w))).toBe(true);
    expect((await gen(["gibberish"])).every((w) => /^[a-z]{1,7}$/.test(w))).toBe(true);
    // ascii/specials force punctuation and numbers off
    const sp = await gen(["specials"], { ...base, punctuation: true, numbers: true });
    expect(sp.every((w) => /^[^a-zA-Z0-9 ]+$/.test(w))).toBe(true);
    // word-source funboxes don't touch quotes; text funboxes do
    const quote = { ...base, mode: "quote" as const };
    expect(await gen(["gibberish"], quote)).toEqual((await generateText(quote, "x")).text.split(" "));
    expect(await gen(["ALL_CAPS"], quote)).toEqual((await generateText(quote, "x")).text.toUpperCase().split(" "));
  });

  it("polyglot mixes languages", async () => {
    const words = (await generateText({ ...base, words: 200, funbox: ["polyglot"] }, "poly")).text;
    expect(/[àâçéèêëîïôûùüÿñæœäöüß]/i.test(words)).toBe(true);
  });
});

describe("funbox typing rules", () => {
  it("nospace submits a word once it's long enough and ignores space", () => {
    const opts = funboxTypingOptions(["nospace"]);
    expect(opts.nospace).toBe(true);
    const s = createState("ab cd", undefined, opts);
    for (const c of "a b") applyKey(s, c);
    expect(s.wi).toBe(1);
    for (const c of "cd") applyKey(s, c);
    expect(s.finished).toBe(true);
    expect(caretIndex(s)).toBe(5);
    expect(finalStats(s, 60_000).chars).toBe(4);
  });

  it("nospace lets you go back into a wrong word", () => {
    const s = createState("ab cd ef", undefined, { nospace: true });
    for (const c of "ax") applyKey(s, c);
    expect(s.wi).toBe(1);
    applyKey(s, "\b");
    expect(s.wi).toBe(0);
    applyKey(s, "z"); // full word: ignored until the mistake is deleted
    expect(s.inputs[0]).toBe("ax");
    applyKey(s, "\b");
    applyKey(s, "b");
    expect(s.wi).toBe(1);
    const r = replay("ab cd", [..."abcd"].map((k, t) => ({ k, t })), Infinity, undefined, { nospace: true });
    expect(r.finished).toBe(true);
  });

  it("only arrows/morse/underscore/nospace change typing rules", () => {
    for (const id of FUNBOX_IDS) {
      const ns = funboxTypingOptions([id]).nospace ?? false;
      expect(ns).toBe(["arrows", "morse", "underscore_spaces", "nospace"].includes(id));
    }
  });
});

describe("funbox compatibility", () => {
  it("follows monkeytype's rules", () => {
    expect(checkFunboxCompatibility(["gibberish"], "ascii")).toBe(false);
    expect(checkFunboxCompatibility(["rAnDoMcAsE"], "capitals")).toBe(false);
    expect(checkFunboxCompatibility(["mirror"], "upside_down")).toBe(false);
    expect(checkFunboxCompatibility(["choo_choo"], "earthquake")).toBe(false);
    expect(checkFunboxCompatibility(["nospace"], "arrows")).toBe(false);
    expect(checkFunboxCompatibility(["read_ahead"], "memory")).toBe(false);
    expect(checkFunboxCompatibility(["58008"], "capitals")).toBe(false);
    expect(checkFunboxCompatibility(["layout_mirror"], "arrows")).toBe(false);
    expect(checkFunboxCompatibility(["tts"], "gibberish")).toBe(false);
    expect(checkFunboxCompatibility(["nausea", "gibberish"], "ddoouubblleedd")).toBe(true);
    expect(checkFunboxCompatibility(["crt", "earthquake", "backwards"])).toBe(true);
    expect(checkFunboxCompatibility(["nope"])).toBe(false);
  });

  it("sanitizes untrusted lists", () => {
    expect(sanitizeFunbox(["mirror", "upside_down", "bogus", "mirror", 3, "gibberish"])).toEqual(["mirror", "gibberish"]);
    expect(sanitizeFunbox(undefined)).toEqual([]);
  });

  it("strips funbox from matchmade settings", () => {
    const s = { ...base, funbox: ["mirror", "gibberish"] as FunboxId[] };
    expect("funbox" in withFunbox(s, false)).toBe(false);
    expect(withFunbox(s, true).funbox).toEqual(["mirror", "gibberish"]);
    expect("funbox" in withFunbox({ ...base, funbox: [] }, true)).toBe(false);
  });
});
