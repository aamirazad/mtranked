// The homepage headline. It changes with the time of day and on holidays, but
// stays put within a stretch of the day so it doesn't flip on every refresh.

/** [text, accent]: the accent part is drawn in the theme's main color */
export type Headline = [text: string, accent?: string];

const HOLIDAYS: Record<string, Headline> = {
  "1-1": ["new year, ", "new pb."],
  "2-14": ["love at first ", "keystroke."],
  "2-29": ["a bonus day. ", "spend it typing."],
  "3-14": ["happy π day. go round again."],
  "4-1": ["your keyboard is now dvorak. (it isn't.)"],
  "5-4": ["may the fourth be ", "with your fingers."],
  "6-23": ["happy typewriter day. ", "ding!"],
  "10-31": ["trick or ", "type."],
  "12-24": ["one more race before santa shows up."],
  "12-25": ["merry christmas. ", "unwrap a new pb."],
  "12-31": ["last chance for a pb ", "this year."],
};

/** Time-of-day stretches, by the hour they start. Each gets its own headline. */
const PARTS: { from: number; lines: Headline[] }[] = [
  {
    from: 0,
    lines: [
      ["up typing this late?"],
      ["can't sleep? ", "same."],
      ["night owls type faster. probably."],
      ["the keyboard never sleeps."],
      ["shh. ", "type quietly."],
    ],
  },
  {
    from: 5,
    lines: [
      ["early bird gets the ", "wpm."],
      ["rise and type."],
      ["type first, ", "coffee second."],
      ["up before the sun? ", "respect."],
    ],
  },
  {
    from: 9,
    lines: [
      ["morning. ", "fingers ready?"],
      ["good morning, ", "speedster."],
      ["a quick race to wake up?"],
      ["warm up those fingers."],
    ],
  },
  {
    from: 12,
    lines: [
      ["lunch break? ", "race someone."],
      ["afternoon slump? ", "type it off."],
      ["one race. then back to work. maybe."],
    ],
  },
  {
    from: 17,
    lines: [
      ["clocked out? ", "clock some wpm."],
      ["golden hour for a ", "new pb."],
      ["dinner can wait. ", "one race."],
      ["evening warm-up, or ", "evening war?"],
    ],
  },
  {
    from: 21,
    lines: [
      ["one more race before bed."],
      ["late night, ", "fast fingers."],
      ["the night is young. ", "so are your fingers."],
      ["bedtime? ", "after this one."],
    ],
  },
];

/** extra picks for daytime on certain weekdays (0 is sunday) */
const WEEKDAYS: Record<number, Headline[]> = {
  0: [["sunday funday. ", "typing edition."]],
  1: [["case of the mondays? ", "type it out."]],
  5: [["it's friday. ", "type like it."]],
  6: [["weekend mode: ", "unlimited races."]],
};

/** 4th thursday of november */
function isThanksgiving(d: Date): boolean {
  return d.getMonth() === 10 && d.getDay() === 4 && d.getDate() >= 22 && d.getDate() <= 28;
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function greeting(now = new Date()): Headline {
  const holiday = HOLIDAYS[`${now.getMonth() + 1}-${now.getDate()}`];
  if (holiday) return holiday;
  if (isThanksgiving(now)) return ["give thanks for ", "fast fingers."];
  if (now.getDay() === 5 && now.getDate() === 13) return ["friday the 13th. ", "mind your typos."];

  const part = PARTS.findLastIndex((p) => now.getHours() >= p.from);
  const daytime = part >= 2 && part <= 4;
  const pool = [...PARTS[part].lines, ...(daytime ? (WEEKDAYS[now.getDay()] ?? []) : [])];
  // same day and same stretch of it -> same pick
  return pool[hash(`${now.toDateString()} ${part}`) % pool.length];
}
