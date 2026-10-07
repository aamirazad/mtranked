import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL ?? "postgres://mtr:mtr@localhost:5433/mtr", {
  max: Number(process.env.DB_POOL ?? 10),
  onnotice: () => {},
  transform: { undefined: null },
});
/** Either the pool or a transaction handle. */
export type Sql = postgres.Sql | postgres.TransactionSql;
