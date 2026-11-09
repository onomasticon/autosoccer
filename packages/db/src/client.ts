import postgres from "postgres";

export type Db = postgres.Sql;

/** Creates a pooled Postgres client. Numeric/bigint columns are parsed as JS numbers. */
export function createDb(url: string, opts: { max?: number } = {}): Db {
  return postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    types: {
      bigint: postgres.BigInt,
    },
    transform: { undefined: null },
  });
}
