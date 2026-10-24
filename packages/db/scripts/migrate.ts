import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "../src/client";

const dir = join(import.meta.dirname, "..", "migrations");
await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`;
const done = new Set((await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name));
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  if (done.has(file)) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(join(dir, file), "utf8"));
    await tx`insert into _migrations (name) values (${file})`;
  });
  console.log("applied", file);
}
console.log("migrations up to date");
await sql.end();
