import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL ?? "postgres://mtr:mtr@localhost:5433/mtr", {
  max: Number(process.env.DB_POOL ?? 10),
  onnotice: () => {},
  transform: { undefined: null },
});
/** Either the pool or a transaction handle. */
export type Sql = postgres.Sql | postgres.TransactionSql;

const INT4_OID = 23;
/**
 * Bind a number[] as an integer[] parameter. postgres.js can't infer a type for plain JS numbers,
 * so an untyped `sql.array(nums)` is sent as text[] and inserts into integer[] columns fail.
 */
export const intArray = (db: Sql, values: number[]) => db.array(values, INT4_OID);
