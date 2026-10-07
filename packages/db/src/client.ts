import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL ?? "postgres://mtr:mtr@localhost:5433/mtr", {
  max: Number(process.env.DB_POOL ?? 10),
  onnotice: () => {},
  transform: { undefined: null },
});
export type Sql = typeof sql;
