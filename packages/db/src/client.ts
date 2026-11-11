import { readFileSync } from "node:fs";
import postgres from "postgres";

export type Db = postgres.Sql;

/**
 * Creates a pooled Postgres client. int8 (bigint) columns are parsed as JS numbers: every
 * bigint we store (seeds ≤ 2^32, micro-USD amounts) is far below Number.MAX_SAFE_INTEGER.
 */
export interface CreateDbOptions {
  max?: number;
  /**
   * PEM CA file for verifying the server certificate (e.g. a managed Postgres service).
   * TLS mode itself comes from the URL's sslmode (require, verify-full, ...).
   */
  caFile?: string;
}

export function createDb(url: string, opts: CreateDbOptions = {}): Db {
  return postgres(url, {
    max: opts.max ?? 10,
    ...(opts.caFile ? { ssl: { ca: readFileSync(opts.caFile, "utf8"), rejectUnauthorized: true } } : {}),
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
