import { createDb } from "./client.ts";
import { migrate } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env or export it.");
  process.exit(1);
}
const db = createDb(url, { max: 1, caFile: process.env.DATABASE_CA_CERT_FILE || undefined });
try {
  const { applied, skipped } = await migrate(db);
  console.log(`migrations: ${applied.length} applied, ${skipped.length} already up to date`);
  for (const name of applied) console.log(`  + ${name}`);
} finally {
  await db.end();
}
