import { sql } from "../src/client";
const email = process.argv[2];
if (!email) throw new Error("usage: pnpm make-moderator you@example.com");
const r = await sql`update users set is_moderator = true where email = ${email} returning display_name`;
console.log(r.length ? `${r[0]!.display_name} is now a moderator` : "no such user");
await sql.end();
