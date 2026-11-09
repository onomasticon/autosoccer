/** Renders docs/api/openapi.json and docs/api/examples/*.json from the contracts. */

import type { z } from "zod";
import * as api from "./api.ts";
import { EditorialFacts } from "./editorial.ts";
import * as ex from "./examples.ts";
import { Job } from "./jobs.ts";
import { MatchRequest, MatchResult } from "./match.ts";
import { buildOpenApi } from "./openapi.ts";

export const EXAMPLES: Array<{ name: string; schema: z.ZodType; value: unknown }> = [
  { name: "match-request", schema: MatchRequest, value: ex.exampleMatchRequest },
  { name: "match-result", schema: MatchResult, value: ex.exampleMatchResult },
  { name: "editorial-facts", schema: EditorialFacts, value: ex.exampleEditorialFacts },
  { name: "job", schema: Job, value: ex.exampleJob },
  { name: "season", schema: api.SeasonResponse, value: ex.exampleSeasonResponse },
  { name: "standings", schema: api.StandingsResponse, value: ex.exampleStandings },
  { name: "fixtures", schema: api.FixturesResponse, value: ex.exampleFixtures },
  { name: "team-detail", schema: api.TeamDetailResponse, value: ex.exampleTeamDetail },
  { name: "match-detail", schema: api.MatchDetailResponse, value: ex.exampleMatchDetail },
  { name: "article-detail", schema: api.ArticleDetailResponse, value: ex.exampleArticleDetail },
];

export function renderGenerated(): Record<string, string> {
  const files: Record<string, string> = { "openapi.json": `${JSON.stringify(buildOpenApi(), null, 2)}\n` };
  for (const e of EXAMPLES) files[`examples/${e.name}.json`] = `${JSON.stringify(e.value, null, 2)}\n`;
  return files;
}

if (import.meta.main) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const root = new URL("../../../docs/api/", import.meta.url).pathname;
  mkdirSync(`${root}examples`, { recursive: true });
  for (const [path, body] of Object.entries(renderGenerated())) writeFileSync(root + path, body);
  console.log(`wrote ${Object.keys(renderGenerated()).length} files to docs/api`);
}
