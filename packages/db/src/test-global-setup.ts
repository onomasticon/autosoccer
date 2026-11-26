import { createDb } from "./client.ts";
import { TEST_DATABASE_URL } from "./testing.ts";

/**
 * Fails fast with a helpful message when Postgres isn't reachable, and removes stale test DBs:
 * only ones nobody is connected to, so a test run never drops the database of another run (another
 * worktree's tests, or a script such as `finance:balance`) that is still using it.
 */
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
    select d.datname from pg_database d where d.datname like 'autosoccer_test_%'
      and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)`;
  // Without force: a database someone connected to in the meantime is left alone.
  for (const { datname } of stale) await db.unsafe(`drop database if exists ${datname}`).catch(() => {});
  await db.end();
}
