/**
 * Manager profile (contract "manager-profile/1"): what an AI manager's *recorded* decisions say
 * about them, across every season they've managed. Built from the Inside the Dugout chapters
 * (official tactical revisions that actually played, results, run statuses), never from what a
 * manager says about itself.
 *
 * - Only a decision the manager actually made for a fixture counts (a new or deliberately kept
 *   setup). The pre-season plan, budget skips and failed or rejected runs are counted separately.
 * - Each trait is a fixed rule over those decisions, with a minimum sample, and carries the
 *   matches that support it. Below MIN_DECISIONS the verdict is "too early" and no trait is given.
 * - Rationale and lessons are the manager's own words (AI-written, unverified) and only appear
 *   as such; they never feed a trait.
 */
import type {
  ChapterRef,
  DugoutChapter,
  ManagerProfile,
  ManagerStory,
  ManagerTrait,
  NotableDecision,
  Team,
} from "@autosoccer/contracts";
import { MANAGER_PROFILE_CONTRACT } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import type { SeasonRow } from "../league/read.ts";
import { teamDugout } from "./read.ts";

/** Fewer decisions than this and the profile says it's too early to describe the manager. */
export const MIN_DECISIONS = 3;

export interface SeasonStory {
  season: { slug: string; name: string };
  story: ManagerStory;
}

interface Played {
  ref: ChapterRef;
  chapter: DugoutChapter;
}

const ref = (season: SeasonStory["season"], c: DugoutChapter): ChapterRef => ({
  season,
  round: c.round,
  fixtureId: c.fixtureId,
  matchId: c.result?.matchId ?? null,
  opponent: c.opponent,
  venue: c.venue,
  score: c.result ? { for: c.result.goalsFor, against: c.result.goalsAgainst } : null,
  outcome: c.result?.outcome ?? null,
  revisionVersion: c.decision.revisionVersion,
});

/** A decision the manager actually made for this fixture (not inherited, skipped or failed). */
const decided = (c: DugoutChapter) =>
  (c.decision.status === "new" || c.decision.status === "kept") && c.decision.decidedAt !== null;
const changed = (c: DugoutChapter) => c.decision.changes.length > 0;
const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;

/** Builds the profile from a manager's stories, oldest season first. Pure. */
export function buildProfile(team: Team, stories: SeasonStory[]): ManagerProfile {
  const manager = stories.find((s) => s.story.manager)?.story.manager ?? null;
  const played: Played[] = stories.flatMap((s) =>
    s.story.chapters.filter((c) => c.status === "completed").map((c) => ({ ref: ref(s.season, c), chapter: c })),
  );
  // Each decision, with the result the manager had just seen (the previous match, same season).
  const steps = played.map((p, i) => {
    const prev = played[i - 1];
    const sameSeason = prev && prev.ref.season.slug === p.ref.season.slug;
    return { ...p, prev: sameSeason ? prev : undefined };
  });
  const decisions = steps.filter((s) => decided(s.chapter));
  const afterDefeat = decisions.filter((s) => s.prev?.chapter.result?.outcome === "L");
  const afterOther = decisions.filter((s) => s.prev && s.prev.chapter.result?.outcome !== "L");
  const record = { W: 0, D: 0, L: 0 };
  for (const p of played) if (p.chapter.result) record[p.chapter.result.outcome]++;
  const tactics = decisions.map((s) => s.chapter.decision.tactics).filter((t) => !!t);
  const share = (pred: (t: NonNullable<DugoutChapter["decision"]["tactics"]>) => boolean) =>
    tactics.length ? tactics.filter(pred).length / tactics.length : 0;
  const turnover = decisions.length
    ? decisions.reduce((sum, s) => sum + s.chapter.decision.lineupIn.length, 0) / decisions.length
    : 0;
  const counts: ManagerProfile["counts"] = {
    matches: played.length,
    decisions: decisions.length,
    changed: decisions.filter((s) => changed(s.chapter)).length,
    formationChanges: decisions.filter((s) => s.chapter.decision.changes.some((c) => c.field === "formation")).length,
    opening: played.filter((p) => p.chapter.decision.status === "opening").length,
    skippedBudget: played.filter((p) => p.chapter.decision.status === "skipped_budget").length,
    failedOrRejected: played.filter((p) => ["failed", "rejected"].includes(p.chapter.decision.status)).length,
    record,
    afterDefeat: { decisions: afterDefeat.length, changed: afterDefeat.filter((s) => changed(s.chapter)).length },
    afterWinOrDraw: { decisions: afterOther.length, changed: afterOther.filter((s) => changed(s.chapter)).length },
    lineupTurnover: Math.round(turnover * 100) / 100,
  };

  const traits: ManagerTrait[] = [];
  const evidence = (xs: typeof steps) => xs.slice(-3).map((s) => s.ref);
  const verdict = decisions.length >= MIN_DECISIONS ? "profiled" : "too_early";
  if (verdict === "profiled") {
    const rate = counts.changed / counts.decisions;
    if (counts.decisions >= 4 && rate >= 0.6)
      traits.push({
        key: "tinkerer",
        label: "Tinkerer",
        basis: `Changed the setup in ${counts.changed} of ${n(counts.decisions, "decision")}.`,
        evidence: evidence(decisions.filter((s) => changed(s.chapter))),
      });
    if (counts.decisions >= 4 && rate <= 0.25)
      traits.push({
        key: "settled",
        label: "Settled",
        basis: `Kept the same setup in ${counts.decisions - counts.changed} of ${n(counts.decisions, "decision")}.`,
        evidence: evidence(decisions.filter((s) => !changed(s.chapter))),
      });
    const rL = counts.afterDefeat.decisions ? counts.afterDefeat.changed / counts.afterDefeat.decisions : 0;
    const rO = counts.afterWinOrDraw.decisions ? counts.afterWinOrDraw.changed / counts.afterWinOrDraw.decisions : 0;
    if (counts.afterDefeat.decisions >= 2 && rL >= 2 / 3 && rL - rO >= 0.34)
      traits.push({
        key: "reacts_to_defeat",
        label: "Reacts to defeat",
        basis: `Changed the setup after ${counts.afterDefeat.changed} of ${n(counts.afterDefeat.decisions, "defeat")}, against ${counts.afterWinOrDraw.changed} of ${counts.afterWinOrDraw.decisions} after a win or draw.`,
        evidence: evidence(afterDefeat.filter((s) => changed(s.chapter))),
      });
    if (counts.afterDefeat.decisions >= 2 && counts.afterDefeat.changed === 0)
      traits.push({
        key: "holds_after_defeat",
        label: "Holds firm after defeat",
        basis: `Kept the same setup after all ${n(counts.afterDefeat.decisions, "defeat")}.`,
        evidence: evidence(afterDefeat),
      });
    const front = (t: NonNullable<DugoutChapter["decision"]["tactics"]>) =>
      t.pressing === "high" || t.lineHeight === "high";
    const back = (t: NonNullable<DugoutChapter["decision"]["tactics"]>) =>
      t.pressing === "low" || t.lineHeight === "deep";
    const frontShare = share(front);
    const backShare = share(back);
    if (frontShare >= 2 / 3 && frontShare > backShare)
      traits.push({
        key: "front_foot",
        label: "Front-foot",
        basis: `Pressed high or held a high line in ${Math.round(frontShare * tactics.length)} of ${n(tactics.length, "decision")}.`,
        evidence: evidence(decisions.filter((s) => s.chapter.decision.tactics && front(s.chapter.decision.tactics))),
      });
    if (backShare >= 2 / 3 && backShare > frontShare)
      traits.push({
        key: "cautious",
        label: "Cautious",
        basis: `Sat deep or pressed low in ${Math.round(backShare * tactics.length)} of ${n(tactics.length, "decision")}.`,
        evidence: evidence(decisions.filter((s) => s.chapter.decision.tactics && back(s.chapter.decision.tactics))),
      });
    if (turnover >= 1.5)
      traits.push({
        key: "rotates",
        label: "Rotates the side",
        basis: `Brought in ${counts.lineupTurnover.toFixed(1)} new starters per decision on average.`,
        evidence: evidence(decisions.filter((s) => s.chapter.decision.lineupIn.length >= 2)),
      });
  }

  const notable: NotableDecision[] = decisions
    .filter((s) => changed(s.chapter))
    .map((s) => ({
      s,
      weight:
        (s.chapter.decision.changes.some((c) => c.field === "formation") ? 3 : 0) +
        s.chapter.decision.changes.length +
        (s.prev?.chapter.result?.outcome === "L" ? 1 : 0),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ s }) => s)
    .sort((a, b) => steps.indexOf(a) - steps.indexOf(b))
    .map((s) => ({
      at: s.ref,
      before: s.prev?.ref ?? null,
      changes: s.chapter.decision.changes,
      summary: s.chapter.decision.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("; "),
      rationale: s.chapter.decision.rationale,
    }));

  const last = played.at(-1);
  const reviewed = [...played].reverse().find((p) => p.chapter.reflection?.lesson);
  const current = stories.at(-1)?.story;
  const upcoming = current?.chapters.find((c) => c.status === "upcoming");
  return {
    contract: MANAGER_PROFILE_CONTRACT,
    team,
    manager,
    seasons: stories.map((s) => s.season),
    verdict,
    counts,
    traits: traits.filter((t) => t.evidence.length >= 2),
    notable,
    current: {
      summary: last?.chapter.decision.summary ?? upcoming?.decision.summary ?? "No match on record yet",
      lesson: reviewed?.chapter.reflection?.lesson ?? null,
      lessonAt: reviewed?.ref ?? null,
      next: upcoming
        ? {
            fixtureId: upcoming.fixtureId,
            round: upcoming.round,
            opponent: upcoming.opponent,
            status: upcoming.decision.status,
          }
        : null,
    },
  };
}

/**
 * The profile across every season the club has played (or just `season`), oldest first. Seasons
 * still to start add only their upcoming fixture.
 */
export async function managerProfile(db: Db, team: Team, season?: SeasonRow): Promise<ManagerProfile> {
  const seasons = season
    ? [season]
    : await db<SeasonRow[]>`
        select s.* from seasons s join season_teams st on st.season_id = s.id
        where st.team_id = ${team.id} and s.status <> 'draft'
        order by coalesce(s.starts_at, s.created_at), s.created_at`;
  const stories: SeasonStory[] = [];
  for (const s of seasons)
    stories.push({ season: { slug: s.slug, name: s.name }, story: await teamDugout(db, s, team) });
  return buildProfile(team, stories);
}
