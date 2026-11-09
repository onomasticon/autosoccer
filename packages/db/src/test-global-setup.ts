import { createDb } from "./client.ts";
import { TEST_DATABASE_URL } from "./testing.ts";

/** Fails fast with a helpful message when Postgres isn't reachable, and removes stale test DBs. */
export default async function setup() {
  const db = createDb(TEST_DATABASE_URL, { max: 1 });
  try {
    await db`select 1`;
  } catch (e) {
    throw new Error(
      `Tests need Postgres at ${TEST_DATABASE_URL} (run \`bun run db:up\`). Cause: ${(e as Error).message}`,
    );
  }
  const stale = await db<{ datname: string }[]>`
    select datname from pg_database where datname like 'autosoccer_test_%'`;
  for (const { datname } of stale) await db.unsafe(`drop database if exists ${datname} with (force)`);
  await db.end();
}
