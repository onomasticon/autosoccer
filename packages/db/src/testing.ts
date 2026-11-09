import { randomBytes } from "node:crypto";
import { createDb, type Db } from "./client.ts";
import { migrate } from "./migrate.ts";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://autosoccer:autosoccer@localhost:54329/autosoccer";

export interface TestDatabase {
  db: Db;
  url: string;
  name: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Creates an isolated, fully migrated database for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `autosoccer_test_${randomBytes(5).toString("hex")}`;
  const admin = createDb(TEST_DATABASE_URL, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const url = withDatabase(TEST_DATABASE_URL, name);
  const db = createDb(url, { max: 5 });
  await migrate(db);
  return {
    db,
    url,
    name,
    async drop() {
      await db.end();
      const a = createDb(TEST_DATABASE_URL, { max: 1 });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
