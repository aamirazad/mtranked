// End the current season and start the next one (run from cron every ~3 months,
// or by hand). Ratings are pulled toward 1500 and uncertainty is raised.
import { seasonReset } from "@mtr/shared";
import { sql } from "../src/client";

const months = Number(process.argv[2] ?? 3);
await sql.begin(async (tx) => {
  const [cur] = await tx`select * from seasons order by starts_at desc limit 1`;
  if (!cur) throw new Error("no season");
  const nextId = cur.id + 1;
  await tx`update seasons set ends_at = now() where id = ${cur.id}`;
  await tx`insert into seasons (id, name, starts_at, ends_at)
    values (${nextId}, ${"Season " + nextId}, now(), now() + make_interval(months => ${months}))`;
  const rows = await tx`select * from ratings where season_id = ${cur.id}`;
  for (const r of rows) {
    const n = seasonReset({ rating: r.rating, rd: r.rd, vol: r.volatility }, cur.reset_params);
    await tx`insert into ratings (user_id, season_id, rating, rd, volatility, races, peak)
      values (${r.user_id}, ${nextId}, ${n.rating}, ${n.rd}, ${n.vol}, 0, 0)`;
  }
  console.log(`season ${cur.id} closed; season ${nextId} started with ${rows.length} carried ratings`);
});
await sql.end();
