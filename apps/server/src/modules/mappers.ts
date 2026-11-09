/** Row → contract mappers shared by the feature modules. */
import type {
  ControllerDeployment,
  Fixture,
  FixtureView,
  Lineup,
  Match,
  Player,
  ReplayArtifact,
  SimVersionInfo,
  TacticalRevision,
  Team,
} from "@autosoccer/contracts";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  city: string;
  primary_color: string;
  secondary_color: string;
  crest: Team["crest"];
}
export const toTeam = (r: TeamRow): Team => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  shortName: r.short_name,
  city: r.city,
  colors: { primary: r.primary_color, secondary: r.secondary_color },
  crest: r.crest,
});

export interface PlayerRow {
  id: string;
  team_id: string;
  name: string;
  shirt_number: number;
  position: Player["position"];
}
export const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  teamId: r.team_id,
  name: r.name,
  shirtNumber: r.shirt_number,
  position: r.position,
});

export interface FixtureRow {
  id: string;
  season_id: string;
  round: number;
  home_team_id: string;
  away_team_id: string;
  status: Fixture["status"];
  seed: number;
  scheduled_at: Date | null;
  match_id?: string | null;
  home_score?: number | null;
  away_score?: number | null;
}
export const toFixture = (r: FixtureRow): Fixture => ({
  id: r.id,
  seasonId: r.season_id,
  round: r.round,
  homeTeamId: r.home_team_id,
  awayTeamId: r.away_team_id,
  status: r.status,
  scheduledAt: iso(r.scheduled_at),
  matchId: r.match_id ?? null,
});
export const toFixtureView = (r: FixtureRow, teams: Map<string, Team>): FixtureView => ({
  ...toFixture(r),
  home: teams.get(r.home_team_id)!,
  away: teams.get(r.away_team_id)!,
  score:
    r.status === "completed" && r.home_score != null && r.away_score != null
      ? { home: r.home_score, away: r.away_score }
      : null,
});

export interface MatchRow {
  id: string;
  fixture_id: string;
  status: Match["status"];
  seed: number;
  request_hash: string;
  request: unknown;
  versions: SimVersionInfo;
  home_revision_id: string | null;
  away_revision_id: string | null;
  home_score: number | null;
  away_score: number | null;
  final_hash: string | null;
  ticks: number | null;
  events: unknown;
  stats: unknown;
  diagnostics: unknown;
  started_at: Date | null;
  completed_at: Date | null;
}
export const toMatch = (r: MatchRow): Match => ({
  id: r.id,
  fixtureId: r.fixture_id,
  status: r.status,
  seed: r.seed,
  requestHash: r.request_hash,
  homeScore: r.home_score,
  awayScore: r.away_score,
  finalHash: r.final_hash,
  versions: r.versions,
  homeRevisionId: r.home_revision_id,
  awayRevisionId: r.away_revision_id,
  startedAt: iso(r.started_at),
  completedAt: iso(r.completed_at),
});

export interface ReplayRow {
  id: string;
  match_id: string;
  uri: string;
  format: "autosoccer-replay";
  format_version: number;
  engine_version: string;
  sdk_version: string | null;
  byte_size: number;
  sha256: string;
  final_hash: string;
  verified: boolean;
  created_at: Date;
}
export const toReplay = (r: ReplayRow): ReplayArtifact => ({
  id: r.id,
  matchId: r.match_id,
  uri: r.uri,
  format: r.format,
  formatVersion: r.format_version,
  engineVersion: r.engine_version,
  sdkVersion: r.sdk_version,
  byteSize: r.byte_size,
  sha256: r.sha256,
  finalHash: r.final_hash,
  verified: r.verified,
  createdAt: r.created_at.toISOString(),
});

export interface RevisionRow {
  id: string;
  team_id: string;
  season_id: string;
  version: number;
  fixture_id: string | null;
  deployment: ControllerDeployment;
  lineup: Lineup;
  status: "valid" | "rejected";
  validation_errors: string[];
  source: TacticalRevision["source"];
  agent_run_id: string | null;
  rationale: string | null;
  created_at: Date;
}
export const toRevision = (r: RevisionRow): TacticalRevision => ({
  id: r.id,
  teamId: r.team_id,
  seasonId: r.season_id,
  version: r.version,
  fixtureId: r.fixture_id,
  deployment: r.deployment,
  lineup: r.lineup,
  status: r.status,
  validationErrors: r.validation_errors,
  source: r.source,
  agentRunId: r.agent_run_id,
  rationale: r.rationale,
  createdAt: r.created_at.toISOString(),
});
