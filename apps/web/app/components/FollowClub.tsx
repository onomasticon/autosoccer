/**
 * Follow a club (stored on this device only) and the homepage "Your Club" module.
 * Server render and hydration show the neutral state; the followed club appears after hydration.
 */
import type { ArticleCardView, FixtureView, ManagerStory, Team } from "@autosoccer/contracts";
import { useId, useState } from "react";
import { Link } from "react-router";
import { useFollowedClub } from "../lib/follow";
import { formatDate } from "../lib/format";
import { ArticleCard } from "./ArticleCard";
import { DECISION_TEXT, ProvenanceChip } from "./Dugout";
import { FixtureCard } from "./MatchScoreCard";
import { Panel } from "./SectionHeader";
import { TeamBadge } from "./TeamBadge";

const btn =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet disabled:opacity-60";
const primary = `${btn} border-violet bg-violet text-white hover:bg-violet-deep`;
const secondary = `${btn} border-line bg-surface text-ink hover:border-violet`;

/** Team page: follow / unfollow / switch to this club. */
export function FollowButton({ team, teams }: { team: Team; teams: Team[] }) {
  const { slug, known, follow, unfollow } = useFollowedClub();
  const current = teams.find((t) => t.slug === slug);
  const isThis = slug === team.slug;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="follow-club">
      {isThis ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-lavender px-3 py-1.5 text-sm font-semibold">
            <span aria-hidden>★</span> You follow {team.name}
          </span>
          <button type="button" className={secondary} onClick={unfollow}>
            Unfollow
          </button>
        </>
      ) : (
        <>
          <button type="button" className={primary} disabled={!known} onClick={() => follow(team.slug)}>
            <span aria-hidden>☆</span> {slug ? `Follow ${team.name} instead` : "Follow club"}
          </button>
          {current && <span className="text-xs text-muted-text">You follow {current.name}. This replaces it.</span>}
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {known ? (isThis ? `Following ${team.name}` : "") : ""}
      </span>
    </div>
  );
}

function ClubPicker({
  teams,
  current,
  onPick,
  label,
}: {
  teams: Team[];
  current: string | null;
  onPick: (slug: string) => void;
  label: string;
}) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {teams.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            aria-pressed={t.slug === current}
            className={`${secondary} aria-pressed:border-violet aria-pressed:bg-lavender`}
            onClick={() => onPick(t.slug)}
          >
            <TeamBadge team={t} size="sm" decorative />
            {t.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Homepage entry point. New visitor: a slim "pick a club" strip. Following: the club's last
 * result, next match, the manager's latest decision and lesson, and related stories.
 */
export function YourClub({
  teams,
  fixtures,
  stories,
  articles,
}: {
  teams: Team[];
  fixtures: FixtureView[];
  stories: ManagerStory[] | null;
  articles: ArticleCardView[];
}) {
  const { slug, known, follow, unfollow } = useFollowedClub();
  const [picking, setPicking] = useState(false);
  const headingId = useId();
  if (!known || !teams.length) return null;
  const team = teams.find((t) => t.slug === slug);
  const pick = (s: string) => {
    follow(s);
    setPicking(false);
  };

  if (!slug)
    return (
      <section aria-labelledby={headingId} className="card-surface flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-semi text-lg font-extrabold">
            Follow a club
          </h2>
          <p className="text-sm text-muted-text">
            Get its last result, next match and its AI manager's latest thinking here. Saved on this device only, no
            account needed.
          </p>
        </div>
        <ClubPicker teams={teams} current={null} onPick={pick} label="Choose a club to follow" />
      </section>
    );

  if (!team)
    return (
      <section aria-labelledby={headingId} className="card-surface p-4" data-testid="your-club-missing">
        <h2 id={headingId} className="font-semi text-lg font-extrabold">
          Your club isn't in this season
        </h2>
        <p className="mt-1 text-sm text-muted-text">
          The club you followed on this device isn't playing in the current season. Pick another, or stop following.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ClubPicker teams={teams} current={null} onPick={pick} label="Choose a club to follow" />
          <button type="button" className={secondary} onClick={unfollow}>
            Stop following
          </button>
        </div>
      </section>
    );

  const mine = fixtures.filter((f) => f.homeTeamId === team.id || f.awayTeamId === team.id);
  const last = [...mine].reverse().find((f) => f.status === "completed");
  const next = mine.find((f) => f.status !== "completed");
  const story = stories?.find((s) => s.team.id === team.id) ?? null;
  const lastChapter = story && [...story.chapters].reverse().find((c) => c.status === "completed");
  const nextChapter = story?.chapters.find((c) => c.status === "upcoming");
  const related = articles.filter((a) => a.teamIds.includes(team.id)).slice(0, 2);

  return (
    <Panel
      id={headingId}
      title={`Your club: ${team.name}`}
      tone="coral"
      action={{ to: `/teams/${team.slug}`, label: "Club page" }}
      bodyClassName="p-4"
    >
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-text">Last result</h3>
          {last ? <FixtureCard fixture={last} /> : <p className="text-sm text-muted-text">No matches played yet.</p>}
          <h3 className="pt-2 text-xs font-bold uppercase tracking-wider text-muted-text">Next match</h3>
          {next ? (
            <>
              <FixtureCard fixture={next} />
              {next.scheduledAt && (
                <p className="text-xs text-muted-text">
                  Kick-off {formatDate(next.scheduledAt, { weekday: true, time: true })}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-text">
              {story?.seasonComplete ? "Season complete." : "No upcoming fixture scheduled."}
            </p>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-text">
            {story?.manager ? `${story.manager.name}, AI manager` : "Manager"}
          </h3>
          {!stories ? (
            <p className="text-muted-text">The manager's decisions couldn't be loaded just now.</p>
          ) : lastChapter ? (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <ProvenanceChip kind="decision" />
                <span className="font-semibold">
                  R{lastChapter.round}: {DECISION_TEXT[lastChapter.decision.status]}
                </span>
              </p>
              <p className="text-muted-text">{lastChapter.decision.summary}</p>
              {lastChapter.reflection?.lesson ? (
                <div className="pt-1">
                  <ProvenanceChip kind="view" />
                  <p className="mt-1 font-medium">{lastChapter.reflection.lesson}</p>
                </div>
              ) : (
                <p className="text-muted-text">No post-match lesson recorded for that match.</p>
              )}
              {nextChapter && (
                <p className="text-muted-text">
                  Next decision:{" "}
                  {nextChapter.decision.status === "pending"
                    ? "due before kick-off"
                    : DECISION_TEXT[nextChapter.decision.status]}
                  .
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-text">
              {story?.manager ? "Their first decisions and review appear after round 1." : "No AI manager on record."}
            </p>
          )}
          <Link to={`/teams/${team.slug}#dugout`} className="inline-block font-semibold underline underline-offset-4">
            The full dugout story <span aria-hidden>→</span>
          </Link>
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-text">Latest on {team.name}</h3>
          {related.length ? (
            <div className="grid gap-3">
              {related.map((a) => (
                <ArticleCard key={a.id} article={a} variant="row" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-text">No recent stories about {team.name}.</p>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" className={secondary} aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          Change club
        </button>
        <button type="button" className={secondary} onClick={unfollow}>
          Unfollow
        </button>
        <span className="text-xs text-muted-text">Saved on this device only.</span>
      </div>
      {picking && (
        <div className="mt-3">
          <ClubPicker teams={teams} current={team.slug} onPick={pick} label="Switch to another club" />
        </div>
      )}
    </Panel>
  );
}
