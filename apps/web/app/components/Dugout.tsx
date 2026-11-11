/**
 * Inside the Dugout: what each AI manager decided, what happened, and what they took from it.
 * Every block is labelled by provenance so readers can tell official record from AI opinion:
 *   Decision (official tactics deployed) · Record (official result) · Manager's view (AI-written).
 */
import type {
  DugoutChapter,
  DugoutDecision,
  DugoutReflection,
  ManagerStory,
  SharedResult,
} from "@autosoccer/contracts";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDate } from "../lib/format";
import { Panel } from "./SectionHeader";
import { TeamBadge } from "./TeamBadge";

type Kind = "decision" | "record" | "view";
const KIND: Record<Kind, { label: string; title: string; chip: string }> = {
  decision: {
    label: "Decision",
    title: "Official: the tactics the manager deployed for this match",
    chip: "bg-violet text-white",
  },
  record: {
    label: "Record",
    title: "Official: the result and statistics from the match record",
    chip: "bg-yellow text-ink",
  },
  view: {
    label: "Manager's view",
    title: "AI-written by the manager; their opinion, not fact-checked",
    chip: "border border-dashed border-violet bg-surface text-violet-deep",
  },
};

export function ProvenanceChip({ kind }: { kind: Kind }) {
  const k = KIND[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${k.chip}`}
      title={k.title}
    >
      {k.label}
    </span>
  );
}

/** Key explaining the three provenance labels. */
export function ProvenanceKey({ className = "" }: { className?: string }) {
  return (
    <ul
      className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-text ${className}`}
      aria-label="How to read this"
    >
      <li className="flex items-center gap-1.5">
        <ProvenanceChip kind="decision" /> what they deployed (official)
      </li>
      <li className="flex items-center gap-1.5">
        <ProvenanceChip kind="record" /> what happened (official)
      </li>
      <li className="flex items-center gap-1.5">
        <ProvenanceChip kind="view" /> what they think (AI-written, unverified)
      </li>
    </ul>
  );
}

export const DECISION_TEXT: Record<DugoutDecision["status"], string> = {
  new: "New plan",
  kept: "Kept the plan",
  opening: "Opening plan",
  skipped_budget: "No decision: compute budget spent, last tactics kept",
  rejected: "Proposal failed validation: last valid tactics kept",
  failed: "Decision didn't complete: last valid tactics kept",
  pending: "Decision due before kick-off",
};
const REFLECTION_TEXT: Record<DugoutReflection["status"], string> = {
  reviewed: "",
  skipped_budget: "No review: compute budget spent.",
  failed: "The post-match review didn't complete; no lesson recorded.",
  pending: "Post-match review pending.",
};
const OUTCOME = {
  W: { word: "Won", chip: "bg-violet text-white" },
  D: { word: "Drew", chip: "bg-line text-ink" },
  L: { word: "Lost", chip: "bg-coral text-ink" },
} as const;

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

function Step({ kind, children, className = "" }: { kind: Kind; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div>
        <ProvenanceChip kind={kind} />
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function DecisionBlock({ d, compact = false }: { d: DugoutDecision; compact?: boolean }) {
  const noDecision = d.status === "skipped_budget" || d.status === "rejected" || d.status === "failed";
  return (
    <Step kind="decision">
      <p className="font-semibold">
        {DECISION_TEXT[d.status]}
        {d.revisionVersion !== null && <span className="font-normal text-muted-text"> · v{d.revisionVersion}</span>}
      </p>
      {d.status !== "pending" && <p className="mt-0.5 text-muted-text">{d.summary}</p>}
      {d.changes.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Changes from the previous match">
          {d.changes.map((c) => (
            <li key={c.field} className="rounded bg-lavender px-1.5 py-0.5 text-xs">
              <span className="font-semibold">{c.label}</span> {c.from} <span aria-hidden>→</span>
              <span className="sr-only">changed to</span> <span className="font-semibold">{c.to}</span>
            </li>
          ))}
        </ul>
      )}
      {(d.lineupIn.length > 0 || d.lineupOut.length > 0) && (
        <p className="mt-1.5 text-xs text-muted-text">
          {d.lineupIn.length > 0 && <>In: {d.lineupIn.map((p) => p.name).join(", ")}. </>}
          {d.lineupOut.length > 0 && <>Out: {d.lineupOut.map((p) => p.name).join(", ")}.</>}
        </p>
      )}
      {!compact && d.rationale && (
        <figure className="mt-2 border-l-4 border-dashed border-violet pl-3">
          <figcaption className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-text">
            <ProvenanceChip kind="view" /> their stated reasoning
          </figcaption>
          <p className="italic">{d.rationale}</p>
        </figure>
      )}
      {noDecision && <p className="mt-1 text-xs text-muted-text">No reasoning on record for this match.</p>}
    </Step>
  );
}

function RecordBlock({ c }: { c: DugoutChapter }) {
  const r = c.result!;
  const o = OUTCOME[r.outcome];
  return (
    <Step kind="record">
      <p className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${o.chip}`}>{o.word}</span>
        <span className="tabular font-display text-xl font-extrabold">
          {r.goalsFor}–{r.goalsAgainst}
        </span>
        <span>
          {c.venue === "home" ? "vs" : "at"} {c.opponent.name}
        </span>
      </p>
      <p className="tabular mt-0.5 text-muted-text">
        Possession {pct(r.possession)} · Shots {r.shots ?? "–"}–{r.shotsAgainst ?? "–"}
      </p>
      <Link
        to={`/matches/${r.matchId}`}
        className="mt-1 inline-block text-sm font-semibold underline underline-offset-4 hover:text-violet-deep"
      >
        Match centre &amp; replay <span aria-hidden>→</span>
      </Link>
    </Step>
  );
}

function ReflectionBlock({ r }: { r: DugoutReflection | null }) {
  if (!r)
    return (
      <Step kind="view">
        <p className="text-muted-text">This club has no AI manager, so there is no review.</p>
      </Step>
    );
  return (
    <Step kind="view">
      {r.status === "reviewed" && r.lesson ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-text">Lesson they took</p>
          <p className="mt-0.5 font-medium">{r.lesson}</p>
        </>
      ) : (
        <p className="text-muted-text">{REFLECTION_TEXT[r.status] || "No lesson recorded."}</p>
      )}
    </Step>
  );
}

function NextBlock({ c, seasonComplete }: { c: DugoutChapter | undefined; seasonComplete: boolean }) {
  if (!c)
    return (
      <p className="text-sm text-muted-text">
        {seasonComplete ? "Season complete. No more decisions this season." : "No upcoming fixture scheduled."}
      </p>
    );
  return (
    <p className="text-sm">
      <span className="font-semibold">Next:</span> R{c.round} {c.venue === "home" ? "vs" : "at"} {c.opponent.name}
      {c.scheduledAt && (
        <span className="text-muted-text"> · {formatDate(c.scheduledAt, { weekday: true, time: true })} UTC</span>
      )}
      <span className="block text-muted-text">
        {c.decision.status === "pending" || c.decision.status === "opening"
          ? "Their next decision is made before kick-off."
          : `${DECISION_TEXT[c.decision.status]}${c.decision.revisionVersion ? ` (v${c.decision.revisionVersion})` : ""}.`}
      </span>
    </p>
  );
}

/** One manager's side of a shared result: decision → record → lesson → next. */
function SideColumn({ story, chapter }: { story: ManagerStory | undefined; chapter: DugoutChapter }) {
  const next = story?.chapters.find((c) => c.status === "upcoming");
  const team = story?.team;
  return (
    <article
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
      aria-labelledby={`dugout-${chapter.fixtureId}-${chapter.venue}`}
    >
      <header className="flex items-center gap-3">
        {team && <TeamBadge team={team} size="md" decorative />}
        <div className="min-w-0">
          <h4
            id={`dugout-${chapter.fixtureId}-${chapter.venue}`}
            className="font-semi text-lg font-extrabold leading-tight"
          >
            {story?.manager?.name ?? "No manager"}
          </h4>
          <p className="text-xs text-muted-text">AI manager, {team?.name}</p>
        </div>
      </header>
      <ol className="grid gap-4">
        <li>
          <DecisionBlock d={chapter.decision} />
        </li>
        <li>
          <RecordBlock c={chapter} />
        </li>
        <li>
          <ReflectionBlock r={chapter.reflection} />
        </li>
        <li className="border-t border-line pt-3">
          <NextBlock c={next} seasonComplete={story?.seasonComplete ?? false} />
        </li>
      </ol>
      {team && (
        <Link
          to={`/teams/${team.slug}#dugout`}
          className="mt-auto text-sm font-semibold underline-offset-4 hover:underline"
        >
          {story?.manager?.name ?? team.name}'s full story <span aria-hidden>→</span>
        </Link>
      )}
    </article>
  );
}

/** Homepage module: the latest result as seen from both dugouts, plus the other managers. */
export function InsideTheDugout({ featured, stories }: { featured: SharedResult | null; stories: ManagerStory[] }) {
  const storyOf = (teamId: string) => stories.find((s) => s.team.id === teamId);
  const others = featured
    ? stories.filter((s) => s.team.id !== featured.home.team.id && s.team.id !== featured.away.team.id)
    : stories;
  return (
    <Panel
      id="inside-the-dugout"
      title="Inside the Dugout"
      meta="Every club is run by an AI manager"
      bodyClassName="p-4 sm:p-5"
    >
      <p className="max-w-3xl text-sm">
        Before each match, every club's AI manager picks its tactics. Afterwards it reviews the official result and
        writes itself a lesson for next time. Here's what they decided, what happened, and what they took from it.
      </p>
      <ProvenanceKey className="mt-3" />
      {featured ? (
        <div className="mt-5">
          <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semi text-xl font-extrabold">
            <span className="parallelogram bg-yellow px-2 py-0.5 text-sm uppercase italic">
              Same result, two dugouts
            </span>
            <Link to={`/matches/${featured.matchId}`} className="tabular underline-offset-4 hover:underline">
              R{featured.round}: {featured.home.team.name} {featured.home.score}–{featured.away.score}{" "}
              {featured.away.team.name}
            </Link>
          </h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <SideColumn story={storyOf(featured.home.team.id)} chapter={featured.sides.home} />
            <SideColumn story={storyOf(featured.away.team.id)} chapter={featured.sides.away} />
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-line p-4 text-sm text-muted-text">
          No matches yet. The managers' opening plans are set, and their first decisions and reviews appear here after
          round 1.
        </p>
      )}
      {others.length > 0 && (
        <div className="mt-5">
          <h3 className="font-semi text-lg font-extrabold">{featured ? "Around the other dugouts" : "The managers"}</h3>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {others.map((s) => (
              <li key={s.team.id}>
                <ManagerSnapshot story={s} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Compact: a manager's latest decision and lesson, and what's next. */
export function ManagerSnapshot({ story }: { story: ManagerStory }) {
  const last = [...story.chapters].reverse().find((c) => c.status === "completed");
  const next = story.chapters.find((c) => c.status === "upcoming");
  return (
    <Link
      to={`/teams/${story.team.slug}#dugout`}
      className="flex h-full gap-3 rounded-xl border border-line bg-surface p-3 hover:border-violet"
    >
      <TeamBadge team={story.team} size="sm" decorative />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">
          {story.manager?.name ?? "No manager"} <span className="font-normal text-muted-text">· {story.team.name}</span>
        </p>
        {last ? (
          <>
            <p className="mt-0.5 text-muted-text">
              R{last.round}: {OUTCOME[last.result!.outcome].word.toLowerCase()} {last.result!.goalsFor}–
              {last.result!.goalsAgainst} {last.venue === "home" ? "vs" : "at"} {last.opponent.name} ·{" "}
              {DECISION_TEXT[last.decision.status].split(":")[0]}
            </p>
            {last.reflection?.lesson && (
              <p className="mt-1">
                <span className="sr-only">Manager's view (AI-written): </span>
                <span aria-hidden className="mr-1 text-xs font-bold uppercase text-violet-deep">
                  Lesson
                </span>
                {last.reflection.lesson}
              </p>
            )}
          </>
        ) : (
          <p className="mt-0.5 text-muted-text">Opening plan: {story.chapters[0]?.decision.summary ?? "not set"}</p>
        )}
        <p className="mt-1 text-xs text-muted-text">
          {next
            ? `Next: R${next.round} ${next.venue === "home" ? "vs" : "at"} ${next.opponent.name}`
            : story.seasonComplete
              ? "Season complete"
              : ""}
        </p>
      </div>
    </Link>
  );
}

/** Team page: the whole season's chain, round by round. */
export function DugoutTimeline({ story }: { story: ManagerStory }) {
  if (!story.chapters.length)
    return <p className="card-surface p-4 text-sm text-muted-text">No fixtures scheduled yet.</p>;
  return (
    <div className="space-y-3">
      <ProvenanceKey />
      <ol className="space-y-3">
        {[...story.chapters].reverse().map((c) => (
          <li key={c.fixtureId} className="card-surface p-4">
            <h3 className="flex flex-wrap items-baseline gap-x-2 font-semi text-lg font-extrabold">
              <span className="rounded bg-lavender px-1.5 text-sm">R{c.round}</span>
              {c.venue === "home" ? "vs" : "at"} {c.opponent.name}
              {c.status === "upcoming" && <span className="text-sm font-semibold text-muted-text">Upcoming</span>}
            </h3>
            {c.status === "upcoming" ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <DecisionBlock d={c.decision} />
                <NextBlock c={c} seasonComplete={false} />
              </div>
            ) : (
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <DecisionBlock d={c.decision} />
                <RecordBlock c={c} />
                <ReflectionBlock r={c.reflection} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {story.seasonComplete && <p className="text-sm text-muted-text">Season complete.</p>}
    </div>
  );
}
