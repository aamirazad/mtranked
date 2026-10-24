// Idempotent seed: Season 0 (beta), the cosmetics catalog and a set of
// "ghost" bot replays so ghost races work before real players exist.
import { randomUUID } from "node:crypto";
import {
  BACKSPACE,
  RANKED_SETTINGS,
  finalStats,
  generateText,
  replay,
  seededRandom,
  type Keystroke,
} from "@mtr/engine";
import { COSMETICS } from "@mtr/shared";
import { sql } from "../src/client";

const [season] = await sql`select id from seasons limit 1`;
if (!season) {
  await sql`insert into seasons (id, name, starts_at, ends_at)
    values (0, 'Season 0 (Beta)', now() - interval '1 day', now() + interval '3 months')`;
  console.log("created Season 0");
}

for (const c of COSMETICS) {
  await sql`insert into cosmetics (id, type, unlock_rule) values (${c.id}, ${c.type}, ${sql.json(c.unlock)})
    on conflict (id) do update set type = excluded.type, unlock_rule = excluded.unlock_rule`;
}
console.log(`cosmetics: ${COSMETICS.length}`);

function synthesize(text: string, wpm: number, seed: string): Keystroke[] {
  const rand = seededRandom(seed);
  const mean = 12000 / wpm; // ms per char
  const keys: Keystroke[] = [];
  let t = 250 + rand() * 300;
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  for (const ch of text) {
    const dt = () => Math.max(25, mean * Math.exp(0.35 * gauss() - 0.06));
    if (rand() < 0.025 && ch !== " ") {
      t += dt();
      keys.push({ k: "x", t: Math.round(t) });
      t += dt() * 1.6;
      keys.push({ k: BACKSPACE, t: Math.round(t) });
    }
    t += dt();
    keys.push({ k: ch, t: Math.round(t) });
  }
  return keys;
}

const BOTS = [
  ["ghost_pebble", 38],
  ["ghost_quill", 47],
  ["ghost_ink", 55],
  ["ghost_fern", 62],
  ["ghost_ember", 70],
  ["ghost_harbor", 78],
  ["ghost_lumen", 86],
  ["ghost_vale", 94],
  ["ghost_comet", 103],
  ["ghost_onyx", 112],
  ["ghost_zephyr", 124],
  ["ghost_nova", 138],
] as const;

const { id: seasonId } = (await sql`select id from seasons order by starts_at desc limit 1`)[0]!;
for (const [name, wpm] of BOTS) {
  const existing = await sql`select id from users where display_name = ${name}`;
  if (existing.length) continue;
  const [u] = await sql`insert into users (email, password_hash, display_name, is_bot, email_verified_at)
    values (${name + "@bots.invalid"}, '!', ${name}, true, now()) returning id`;
  const rating = 1500 + (wpm - 80) * 9;
  await sql`insert into ratings (user_id, season_id, rating, rd, races, peak)
    values (${u!.id}, ${seasonId}, ${rating}, 80, 20, ${rating})`;
  for (let i = 0; i < 3; i++) {
    const seed = `${name}-${i}`;
    const { text } = await generateText(RANKED_SETTINGS, seed);
    const keys = synthesize(text, wpm, seed + "k");
    const st = replay(text, keys);
    const dur = keys.at(-1)!.t;
    const stats = finalStats(st, dur);
    const id = randomUUID();
    await sql`insert into matches (id, mode, seed, text_settings, text, season_id, started_at, finished_at)
      values (${id}, 'seed', ${seed}, ${sql.json(RANKED_SETTINGS)}, ${text}, ${seasonId}, now(), now())`;
    await sql`insert into match_players (match_id, slot, user_id, placement, wpm, raw, accuracy, finished_at_ms, finished, rating_before)
      values (${id}, 0, ${u!.id}, 1, ${stats.wpm}, ${stats.raw}, ${stats.acc}, ${dur}, true, ${rating})`;
    await sql`insert into replays (match_id, slot, keystrokes) values (${id}, 0, ${sql.json(keys)})`;
  }
  console.log(`bot ${name} (~${wpm} wpm, rating ${rating})`);
}
await sql.end();
