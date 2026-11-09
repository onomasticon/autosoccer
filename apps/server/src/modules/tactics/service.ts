import type { ControllerDeployment, Lineup, TacticalRevision } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { type PlayerRow, type RevisionRow, toPlayer, toRevision } from "../mappers.ts";
import { type RevisionInput, validateRevision } from "./validate.ts";

export interface CreateRevisionInput extends RevisionInput {
  teamId: string;
  seasonId: string;
  fixtureId?: string | null;
  source: TacticalRevision["source"];
  agentRunId?: string | null;
  rationale?: string | null;
}

/**
 * Validates and stores a tactical revision with the next version number for the team.
 * Invalid proposals are stored too (status "rejected" + errors) for the audit trail, but
 * are never selected for a match. Versions are allocated under a per-team advisory lock.
 */
export async function createRevision(db: Db, input: CreateRevisionInput): Promise<TacticalRevision> {
  const squad = (await db<PlayerRow[]>`select * from players where team_id = ${input.teamId}`).map(toPlayer);
  const v = validateRevision(squad, input);
  const lineup: Lineup = v.lineup ?? { starters: input.starters.slice(0, 5), reserves: [] };
  return db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`revision:${input.teamId}:${input.seasonId}`}))`;
    const [nextRow] = await tx<{ next: number }[]>`
      select coalesce(max(version), 0)::int + 1 as next from tactical_revisions
      where team_id = ${input.teamId} and season_id = ${input.seasonId}`;
    const next = nextRow!.next;
    const [row] = await tx<RevisionRow[]>`
      insert into tactical_revisions (team_id, season_id, version, fixture_id, deployment, lineup, status, validation_errors, source, agent_run_id, rationale)
      values (${input.teamId}, ${input.seasonId}, ${next}, ${input.fixtureId ?? null}, ${tx.json(input.deployment as never)},
        ${tx.json(lineup as never)}, ${v.ok ? "valid" : "rejected"}, ${tx.json(v.errors)}, ${input.source},
        ${input.agentRunId ?? null}, ${input.rationale ?? null})
      returning *`;
    return toRevision(row!);
  });
}

/** The revision a team would play with now: its latest valid one. */
export async function latestValidRevision(db: Db, teamId: string, seasonId: string): Promise<TacticalRevision | null> {
  const [row] = await db<RevisionRow[]>`
    select * from tactical_revisions where team_id = ${teamId} and season_id = ${seasonId} and status = 'valid'
    order by version desc limit 1`;
  return row ? toRevision(row) : null;
}

export async function revisionHistory(db: Db, teamId: string, seasonId: string): Promise<TacticalRevision[]> {
  return (
    await db<
      RevisionRow[]
    >`select * from tactical_revisions where team_id = ${teamId} and season_id = ${seasonId} order by version`
  ).map(toRevision);
}

export const tacticalDeployment = (config: Record<string, unknown>): ControllerDeployment => ({
  kind: "tactical",
  schemaVersion: "tactics/1",
  config,
});
