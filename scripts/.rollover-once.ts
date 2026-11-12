// Local helper (not committed): one scheduler rollover, as production's scheduler would do.
import { createDb } from "@autosoccer/db";
import { loadConfig } from "../apps/server/src/config.ts";
import { rolloverSeason } from "../apps/server/src/modules/league/rollover.ts";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
console.log(await rolloverSeason(db, { managerModel: config.MANAGER_MODEL, editorialModel: config.EDITORIAL_MODEL }));
await db.end();
