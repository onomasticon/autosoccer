/**
 * Contract-shaped mock data for the component tests.
 * Mirrors the four seeded clubs; scores here are illustrative fixtures for UI states only
 * and are never shown on public league pages.
 */
import type { EditorialAgent, FixtureView, StandingRow, Team } from "@autosoccer/contracts";
import type { ArticleCardData } from "../components/ArticleCard";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const mockTeams: Team[] = [
  {
    id: id(1),
    slug: "harbour-city",
    name: "Harbour City",
    shortName: "HBC",
    city: "Harbour City",
    colors: { primary: "#245EFF", secondary: "#FFFFFF" },
    crest: { shape: "shield", glyph: "H" },
  },
  {
    id: id(2),
    slug: "red-rock-rovers",
    name: "Red Rock Rovers",
    shortName: "RRR",
    city: "Red Rock",
    colors: { primary: "#E2412E", secondary: "#FFE7A3" },
    crest: { shape: "circle", glyph: "R" },
  },
  {
    id: id(3),
    slug: "northgate-comets",
    name: "Northgate Comets",
    shortName: "NGC",
    city: "Northgate",
    colors: { primary: "#1F9D74", secondary: "#F5F0E8" },
    crest: { shape: "hexagon", glyph: "N" },
  },
  {
    id: id(4),
    slug: "saltmarsh-athletic",
    name: "Saltmarsh Athletic",
    shortName: "SMA",
    city: "Saltmarsh",
    colors: { primary: "#F2A93B", secondary: "#20203B" },
    crest: { shape: "diamond", glyph: "S" },
  },
];
const [hbc, rrr, ngc, sma] = mockTeams as [Team, Team, Team, Team];

const fx = (
  n: number,
  round: number,
  home: Team,
  away: Team,
  status: FixtureView["status"],
  score: [number, number] | null,
): FixtureView => ({
  id: id(100 + n),
  seasonId: id(900),
  round,
  homeTeamId: home.id,
  awayTeamId: away.id,
  status,
  scheduledAt: "2026-11-09T12:00:00.000Z",
  matchId: score ? id(200 + n) : null,
  home,
  away,
  score: score ? { home: score[0], away: score[1] } : null,
});

export const mockFixtures: FixtureView[] = [
  fx(1, 1, hbc, rrr, "completed", [2, 1]),
  fx(2, 1, sma, ngc, "completed", [0, 0]),
  fx(3, 2, ngc, hbc, "playing", null),
  fx(4, 2, rrr, sma, "ready", null),
  fx(5, 3, sma, hbc, "scheduled", null),
];

const row = (
  position: number,
  team: Team,
  w: number,
  d: number,
  l: number,
  gf: number,
  ga: number,
  form: StandingRow["form"],
): StandingRow => ({
  position,
  team,
  played: w + d + l,
  won: w,
  drawn: d,
  lost: l,
  goalsFor: gf,
  goalsAgainst: ga,
  goalDifference: gf - ga,
  points: w * 3 + d,
  form,
});
export const mockStandings: StandingRow[] = [
  row(1, hbc, 1, 0, 0, 2, 1, ["W"]),
  row(2, ngc, 0, 1, 0, 0, 0, ["D"]),
  row(3, sma, 0, 1, 0, 0, 0, ["D"]),
  row(4, rrr, 0, 0, 1, 1, 2, ["L"]),
];

export const mockJournalists: EditorialAgent[] = [
  {
    id: id(800),
    slug: "nia-park",
    name: "Nia Park",
    role: "reporter",
    bio: "AI match reporter. Writes every report from the official event log.",
    voice: "",
    avatar: { shape: "circle", color: "#6552DD", initials: "NP" },
    model: "",
  },
  {
    id: id(801),
    slug: "otto-brandt",
    name: "Otto Brandt",
    role: "analyst",
    bio: "AI tactics analyst. Reads formations, pressing lines and pass maps.",
    voice: "",
    avatar: { shape: "square", color: "#245EFF", initials: "OB" },
    model: "",
  },
  {
    id: id(802),
    slug: "rae-santos",
    name: "Rae Santos",
    role: "pundit",
    bio: "AI pundit with opinions, clearly labelled as opinion.",
    voice: "",
    avatar: { shape: "hexagon", color: "#D93A25", initials: "RS" },
    model: "",
  },
];

const author = (j: EditorialAgent) => ({ slug: j.slug, name: j.name, role: j.role, avatar: j.avatar });
export const mockArticles: ArticleCardData[] = [
  {
    id: id(810),
    slug: "harbour-city-edge-red-rock-rovers",
    kind: "match_report",
    headline: "Harbour City edge Red Rock Rovers 2–1",
    standfirst: "A late goal settled a tight round-one meeting.",
    matchId: id(201),
    teamIds: [hbc.id, rrr.id],
    aiGenerated: true,
    publishedAt: "2026-11-09T12:30:00.000Z",
    author: author(mockJournalists[0]!),
  },
  {
    id: id(811),
    slug: "saltmarsh-low-block",
    kind: "analysis",
    headline: "How Saltmarsh's low block held Northgate scoreless",
    standfirst: "Two narrow lines and a patient keeper.",
    matchId: id(202),
    teamIds: [sma.id, ngc.id],
    aiGenerated: true,
    publishedAt: "2026-11-09T13:00:00.000Z",
    author: author(mockJournalists[1]!),
  },
  {
    id: id(812),
    slug: "pressing-is-overrated",
    kind: "column",
    headline: "Opinion: high pressing is a luxury in a 5v5 league",
    standfirst: "Fewer players, more space — and more risk.",
    matchId: null,
    teamIds: [],
    aiGenerated: true,
    publishedAt: "2026-11-09T14:00:00.000Z",
    author: author(mockJournalists[2]!),
  },
];
