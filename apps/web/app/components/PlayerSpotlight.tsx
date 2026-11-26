import { playerHref, type Spotlight } from "@autosoccer/contracts";
import { Link } from "react-router";
import { useFollowedClub } from "../lib/follow";
import { kickoffUtc, matchdayHref } from "../lib/matchday";
import { possessive, spotlightHref, surname } from "../lib/spotlight";
import { HeroArt } from "./LeadStory";
import { Slashes } from "./SectionHeader";
import { TeamBadge } from "./TeamBadge";

export const KIND_LABEL: Record<Spotlight["kind"], string> = {
  hat_trick: "Hat-trick",
  brace: "Two goals",
  winner: "The winner",
  equaliser: "The equaliser",
  goal: "On the scoresheet",
  quiet: "Top scorer",
};

const POSITION = { GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" } as const;

/** Follow the spotlight player's club from the lead (device-local, like everywhere else). */
export function FollowFromLead({ team }: { team: Spotlight["team"] }) {
  const { slug, known, follow } = useFollowedClub();
  if (known && slug === team.slug)
    return (
      <span className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-lavender px-3 py-1.5 text-sm font-semibold">
        <span aria-hidden>★</span> You follow {team.name}
      </span>
    );
  return (
    <button
      type="button"
      disabled={!known}
      onClick={() => follow(team.slug)}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet bg-surface px-3 py-1.5 text-sm font-semibold text-violet-deep hover:bg-lavender focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet disabled:opacity-60"
    >
      <span aria-hidden>☆</span> Follow {team.name}
    </button>
  );
}

/**
 * The homepage lead (spotlight/1): one named player, what they did, one verified detail and one
 * specific action, ahead of any club choice. Then: follow their club, its next match, their career.
 */
export function PlayerSpotlight({ lead, as: H = "h2" }: { lead: Spotlight; as?: "h1" | "h2" }) {
  const quiet = lead.kind === "quiet";
  return (
    <section
      aria-labelledby="spotlight-name"
      className="lead-ground relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line shadow-[var(--shadow-card)]"
      data-testid="player-spotlight"
    >
      <div
        aria-hidden
        className="hidden sm:absolute sm:inset-y-0 sm:right-0 sm:block sm:w-[34%] sm:[clip-path:polygon(28%_0,100%_0,100%_100%,0_100%)]"
      >
        <HeroArt teams={[lead.team]} seed={lead.player.id} kind="match_report" />
      </div>
      <div className="relative flex flex-1 flex-col gap-3 p-5 sm:max-w-[70%] sm:gap-4 sm:p-7">
        <p className="flex flex-wrap items-center gap-y-1">
          <span className="parallelogram grad-violet -ml-[0.55em] py-1 pr-[1.2em] font-semi text-base font-extrabold uppercase italic leading-none text-white sm:text-xl">
            {KIND_LABEL[lead.kind]}
          </span>
          <Slashes colors={["violet-light"]} height={28} className="-ml-[0.95rem]" />
          <span className="ml-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-text">
            {lead.season.name} · Round {lead.round}
          </span>
        </p>
        <div>
          <H
            id="spotlight-name"
            className="font-wide text-[2.3rem] font-black uppercase italic leading-[0.9] tracking-[-0.01em] sm:text-[3rem]"
          >
            <Link to={playerHref(lead.player)} className="underline-offset-4 hover:underline">
              {lead.player.name}
            </Link>
          </H>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <TeamBadge team={lead.team} size="sm" decorative />
            <Link to={`/teams/${lead.team.slug}`} className="underline-offset-4 hover:underline">
              {lead.team.name}
            </Link>
            <span className="text-muted-text">
              #{lead.player.shirtNumber} · {POSITION[lead.player.position]}
            </span>
          </p>
        </div>
        <div aria-hidden className="h-2 w-1/2 -skew-x-[20deg] rounded-sm bg-coral" />
        <p className="max-w-prose text-lg font-semibold leading-snug" data-testid="spotlight-headline">
          {lead.headline}
        </p>
        <p className="max-w-prose leading-snug" data-testid="spotlight-detail">
          <span className="mr-2 rounded bg-yellow px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink">
            Record
          </span>
          {lead.detail}
        </p>
        <p>
          <Link
            to={spotlightHref(lead)}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-coral px-4 py-2 font-semi text-lg font-extrabold text-ink shadow-[var(--shadow-card)] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
            data-testid="spotlight-action"
          >
            {lead.replay && !quiet && <span aria-hidden>▶</span>}
            {lead.action}
          </Link>
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
          <FollowFromLead team={lead.team} />
          {lead.next && (
            <Link
              to={matchdayHref(lead.next.fixtureId)}
              className="font-semibold text-violet-deep underline-offset-4 hover:underline"
              data-testid="spotlight-next"
            >
              Next: {lead.next.venue === "home" ? "v" : "at"} {lead.next.opponent.name},{" "}
              {kickoffUtc(lead.next.scheduledAt)} <span aria-hidden>→</span>
            </Link>
          )}
          <Link to={playerHref(lead.player)} className="font-semibold underline-offset-4 hover:underline">
            {possessive(surname(lead.player.name))} career <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
