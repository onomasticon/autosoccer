/**
 * Canonical example payloads for every public contract. They are validated by
 * tests and written to docs/api/examples by `bun run contracts:gen`, so the
 * documentation can never drift from the schemas.
 */
import type { z } from "zod";
import type {
  ArticleDetailResponse,
  FixturesResponse,
  MatchDetailResponse,
  SeasonResponse,
  StandingsResponse,
  TeamDetailResponse,
} from "./api.ts";
import type { EditorialAgent, Player, Season, Team } from "./domain.ts";
import type { EditorialFacts } from "./editorial.ts";
import type { Job } from "./jobs.ts";
import type { MatchRequest, MatchResult, SimVersionInfo, TeamMatchStats } from "./match.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = "2026-11-09T12:00:00.000Z";
const SHA = "a3f1c9e0b7d24c5e8f6a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6a";

export const exampleTeams: Team[] = [
  {
    id: uuid(1),
    slug: "harbour-city",
    name: "Harbour City",
    shortName: "HBC",
    city: "Harbour City",
    colors: { primary: "#245EFF", secondary: "#FFFFFF" },
    crest: { shape: "shield", glyph: "H" },
  },
  {
    id: uuid(2),
    slug: "red-rock-rovers",
    name: "Red Rock Rovers",
    shortName: "RRR",
    city: "Red Rock",
    colors: { primary: "#E2412E", secondary: "#FFE7A3" },
    crest: { shape: "circle", glyph: "R" },
  },
];
const [home, away] = exampleTeams as [Team, Team];

export const examplePlayers: Player[] = [
  { id: uuid(101), teamId: home.id, name: "Ada Okafor", shirtNumber: 1, position: "GK" },
  { id: uuid(102), teamId: home.id, name: "Bruno Lind", shirtNumber: 2, position: "DF" },
  { id: uuid(103), teamId: home.id, name: "Chen Wu", shirtNumber: 3, position: "DF" },
  { id: uuid(104), teamId: home.id, name: "Dara Quinn", shirtNumber: 4, position: "MF" },
  { id: uuid(105), teamId: home.id, name: "Eli Moreau", shirtNumber: 5, position: "FW" },
  { id: uuid(106), teamId: home.id, name: "Femi Adeyemi", shirtNumber: 6, position: "MF" },
  { id: uuid(107), teamId: home.id, name: "Gus Varga", shirtNumber: 7, position: "FW" },
];
const awayStarters = [201, 202, 203, 204, 205].map((n, i) => ({
  playerId: uuid(n),
  name: ["Iris Kale", "Jon Pike", "Kofi Mensah", "Lia Sorn", "Max Ruiz"][i]!,
  shirtNumber: i + 1,
  position: (["GK", "DF", "DF", "MF", "FW"] as const)[i]!,
}));

export const exampleSeason: Season = {
  id: uuid(900),
  slug: "season-1",
  name: "Season 1",
  status: "active",
  seed: 20261109,
  simVersion: "38b8c6f",
  playersPerTeam: 5,
  budgetPerTeamMicroUsd: 1_000_000,
  startsAt: T0,
  completedAt: null,
};

const versions: SimVersionInfo = {
  simCommit: "38b8c6f",
  engineVersion: "0.3.0",
  sdkVersion: "1.2.0",
  adapterVersion: "1.0.0",
  replayFormatVersion: 1,
};
const stats = (goals: number, possession: number): TeamMatchStats => ({
  goals,
  passes: 41,
  passesCompleted: 30,
  passesIntercepted: 9,
  avgPassLength: 11.4,
  forwardPassShare: 0.43,
  shots: 6,
  shotsOnTarget: 3,
  avgShotDistance: 14.2,
  dribbleTouches: 120,
  tackles: 8,
  tacklesWon: 5,
  interceptions: 7,
  keeperCatches: 2,
  keeperReleases: 2,
  fouls: 1,
  restartsTaken: 9,
  restartFallbacks: 0,
  possession,
  avgTeamHeight: 21.7,
});
const tactical = {
  kind: "tactical" as const,
  schemaVersion: "tactics/1",
  config: { formation: "2-1-1", pressing: "high" },
};

export const exampleMatchRequest: MatchRequest = {
  contract: "match-request/1",
  fixtureId: uuid(300),
  seed: 3141592653,
  simVersion: "38b8c6f",
  home: {
    teamId: home.id,
    name: home.name,
    starters: examplePlayers
      .slice(0, 5)
      .map((p) => ({ playerId: p.id, name: p.name, shirtNumber: p.shirtNumber, position: p.position })),
    tacticalRevisionId: uuid(400),
    deployment: tactical,
  },
  away: {
    teamId: away.id,
    name: away.name,
    starters: awayStarters,
    tacticalRevisionId: uuid(401),
    deployment: tactical,
  },
  config: {},
};

export const exampleMatchResult: MatchResult = {
  contract: "match-result/1",
  fixtureId: uuid(300),
  seed: 3141592653,
  versions,
  requestHash: SHA,
  finalHash: "9c1e44a07b3d2f15",
  score: { home: 2, away: 1 },
  events: [
    { type: "periodStart", tick: 120, period: "firstHalf", clockSec: 0 },
    {
      type: "goal",
      tick: 2410,
      period: "firstHalf",
      clockSec: 38.2,
      side: "home",
      scorerId: uuid(105),
      ownGoal: false,
      score: { home: 1, away: 0 },
    },
    {
      type: "foul",
      tick: 4020,
      period: "firstHalf",
      clockSec: 65,
      side: "away",
      playerId: uuid(202),
      againstId: uuid(104),
    },
    {
      type: "restart",
      tick: 4080,
      period: "firstHalf",
      clockSec: 65,
      side: "home",
      restart: "freeKick",
      takerId: uuid(104),
    },
    { type: "periodEnd", tick: 7320, period: "firstHalf", clockSec: 120 },
    {
      type: "goal",
      tick: 9930,
      period: "secondHalf",
      clockSec: 33.5,
      side: "away",
      scorerId: uuid(205),
      ownGoal: false,
      score: { home: 1, away: 1 },
    },
    {
      type: "goal",
      tick: 13800,
      period: "secondHalf",
      clockSec: 98,
      side: "home",
      scorerId: uuid(104),
      ownGoal: false,
      score: { home: 2, away: 1 },
    },
  ],
  stats: { home: stats(2, 0.56), away: stats(1, 0.44) },
  ticks: 14640,
  replay: {
    uri: "file://data/replays/00000000-0000-4000-8000-00000000012c.replay.json.gz",
    sha256: SHA,
    byteSize: 592282,
    verified: true,
  },
  diagnostics: { controllerFailures: [], invariantViolations: [], wallMs: 2130 },
};

const fixtureView = {
  id: uuid(300),
  seasonId: exampleSeason.id,
  round: 1,
  homeTeamId: home.id,
  awayTeamId: away.id,
  status: "completed" as const,
  scheduledAt: T0,
  matchId: uuid(500),
  home,
  away,
  score: { home: 2, away: 1 },
};

export const exampleSeasonResponse: z.infer<typeof SeasonResponse> = {
  season: exampleSeason,
  teams: exampleTeams,
  rounds: 6,
};

export const exampleStandings: z.infer<typeof StandingsResponse> = {
  race: { roundsLeft: 5, contenders: exampleTeams, clinched: null },
  season: exampleSeason,
  afterRound: 1,
  rows: [
    {
      position: 1,
      team: home,
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      goalsFor: 2,
      goalsAgainst: 1,
      goalDifference: 1,
      points: 3,
      form: ["W"],
    },
    {
      position: 2,
      team: away,
      played: 1,
      won: 0,
      drawn: 0,
      lost: 1,
      goalsFor: 1,
      goalsAgainst: 2,
      goalDifference: -1,
      points: 0,
      form: ["L"],
    },
  ],
};

export const exampleFixtures: z.infer<typeof FixturesResponse> = {
  season: exampleSeason,
  rounds: [{ round: 1, fixtures: [fixtureView] }],
};

export const exampleTeamDetail: z.infer<typeof TeamDetailResponse> = {
  team: home,
  players: examplePlayers,
  history: [{ season: { slug: "season-1", name: "Season 1" }, position: 1, points: 11, played: 6, champion: true }],
  goals: examplePlayers.map((p, i) => ({ playerId: p.id, season: i === 4 ? 1 : 0, allTime: i === 4 ? 3 : 0 })),
  memoryWrittenAfter: { season: "Season 2", round: 1 },
  manager: {
    id: uuid(600),
    slug: "marta-sol",
    name: "Marta Sol",
    persona: "Calm, methodical possession coach.",
    philosophy: "Control the ball, control the game.",
    model: "claude-opus-5-5",
    memory: {
      summary: "Won the opener 2–1 with a patient setup.",
      notes: ["R1 vs Red Rock Rovers: W 2–1"],
      updatedAt: T0,
    },
  },
  standing: exampleStandings.rows[0]!,
  fixtures: [fixtureView],
  currentRevision: {
    id: uuid(400),
    version: 2,
    deployment: tactical,
    rationale: "Press higher after conceding few shots.",
    createdAt: T0,
  },
};

export const exampleMatchDetail: z.infer<typeof MatchDetailResponse> = {
  match: {
    id: uuid(500),
    fixtureId: uuid(300),
    status: "completed",
    seed: 3141592653,
    requestHash: SHA,
    homeScore: 2,
    awayScore: 1,
    finalHash: "9c1e44a07b3d2f15",
    versions,
    homeRevisionId: uuid(400),
    awayRevisionId: uuid(401),
    startedAt: T0,
    completedAt: T0,
  },
  fixture: fixtureView,
  events: exampleMatchResult.events,
  stats: exampleMatchResult.stats,
  lineups: {
    home: examplePlayers.slice(0, 5),
    away: awayStarters.map((s) => ({
      id: s.playerId,
      teamId: away.id,
      name: s.name,
      shirtNumber: s.shirtNumber,
      position: s.position,
    })),
  },
  replay: {
    id: uuid(700),
    matchId: uuid(500),
    uri: exampleMatchResult.replay.uri,
    format: "autosoccer-replay",
    formatVersion: 1,
    engineVersion: "0.3.0",
    sdkVersion: "1.2.0",
    byteSize: 592282,
    sha256: SHA,
    finalHash: "9c1e44a07b3d2f15",
    verified: true,
    createdAt: T0,
  },
  revisions: {
    home: { id: uuid(400), version: 2, deployment: tactical, rationale: "Press higher after conceding few shots." },
    away: { id: uuid(401), version: 1, deployment: tactical, rationale: null },
  },
};

export const exampleJournalist: EditorialAgent = {
  id: uuid(800),
  slug: "nia-park",
  name: "Nia Park",
  role: "reporter",
  bio: "AI match reporter covering every fixture from the official record.",
  voice: "Crisp, factual, warm. Short paragraphs. Never invents quotes.",
  avatar: { shape: "circle", color: "#6552DD", initials: "NP" },
  model: "anthropic/claude-haiku-5-5",
};

export const exampleArticleDetail: z.infer<typeof ArticleDetailResponse> = {
  article: {
    id: uuid(810),
    seasonId: exampleSeason.id,
    slug: "harbour-city-edge-red-rock-rovers-2-1",
    kind: "match_report",
    status: "published",
    editorialAgentId: exampleJournalist.id,
    headline: "Harbour City edge Red Rock Rovers 2–1",
    standfirst: "A late Dara Quinn goal settled a tight round-one meeting.",
    body: "Harbour City beat Red Rock Rovers 2–1 in round one.\n\nDara Quinn scored the winner 98 seconds into the second half.",
    citations: [
      { factId: `match:${uuid(500)}:score`, text: "Harbour City beat Red Rock Rovers 2–1" },
      { factId: `match:${uuid(500)}:goal:3`, text: "Dara Quinn scored the winner" },
    ],
    matchId: uuid(500),
    fixtureId: uuid(300),
    teamIds: [home.id, away.id],
    agentRunId: uuid(820),
    aiGenerated: true,
    publishedAt: T0,
    createdAt: T0,
  },
  author: exampleJournalist,
  related: [],
};

export const exampleEditorialFacts: EditorialFacts = {
  contract: "editorial-facts/1",
  seasonId: exampleSeason.id,
  matchId: uuid(500),
  generatedFrom: { resultFinalHash: "9c1e44a07b3d2f15", standingsAfterRound: 1 },
  match: {
    round: 1,
    home: { teamId: home.id, name: home.name, score: 2 },
    away: { teamId: away.id, name: away.name, score: 1 },
    events: exampleMatchResult.events,
    stats: exampleMatchResult.stats,
    lineups: {
      home: examplePlayers.slice(0, 5).map((p) => ({ playerId: p.id, name: p.name, position: p.position })),
      away: awayStarters.map((s) => ({ playerId: s.playerId, name: s.name, position: s.position })),
    },
  },
  facts: [
    {
      id: `match:${uuid(500)}:score`,
      kind: "score",
      statement: "Harbour City 2–1 Red Rock Rovers (round 1)",
      value: { home: 2, away: 1 },
      source: { table: "matches", id: uuid(500) },
    },
    {
      id: `match:${uuid(500)}:goal:3`,
      kind: "goal",
      statement: "Dara Quinn (Harbour City) scored at 98s of the second half",
      value: { tick: 13800 },
      source: { table: "matches", id: uuid(500) },
    },
  ],
};

export const exampleJob: Job = {
  id: uuid(1000),
  kind: "match.play",
  idempotencyKey: `match.play:${uuid(300)}`,
  payload: { fixtureId: uuid(300) },
  status: "succeeded",
  attempts: 1,
  maxAttempts: 3,
  runAt: T0,
  lockedBy: null,
  lockedAt: null,
  lastError: null,
  result: { matchId: uuid(500) },
  artifacts: [
    { kind: "match", id: uuid(500) },
    { kind: "replay", id: uuid(700) },
  ],
  createdAt: T0,
  finishedAt: T0,
};
