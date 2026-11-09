import postgres from "postgres";

export type Db = postgres.Sql;

/**
 * Creates a pooled Postgres client. int8 (bigint) columns are parsed as JS numbers: every
 * bigint we store (seeds ≤ 2^32, micro-USD amounts) is far below Number.MAX_SAFE_INTEGER.
 */
export function createDb(url: string, opts: { max?: number } = {}): Db {
  return postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    types: {
      int8: {
        to: 20,
        from: [20],
        serialize: (x: number | bigint) => x.toString(),
        parse: (x: string) => {
          const n = Number(x);
          if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${x} exceeds the safe integer range`);
          return n;
        },
      },
    },
    transform: { undefined: null },
  });
}
