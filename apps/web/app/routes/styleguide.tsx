import { AgentProfileCard } from "../components/AgentProfileCard";
import { ArticleCard, ArticleCardSkeleton } from "../components/ArticleCard";
import { AiBadge, AuthorByline } from "../components/AuthorByline";
import { FixtureCard, MatchScoreCard } from "../components/MatchScoreCard";
import { ScoreTicker } from "../components/ScoreTicker";
import { SectionHeader } from "../components/SectionHeader";
import { StandingsTable } from "../components/StandingsTable";
import { EmptyState, ErrorState } from "../components/States";
import { StatusChip } from "../components/StatusChip";
import { TeamBadge } from "../components/TeamBadge";
import { mockArticles, mockFixtures, mockJournalists, mockStandings, mockTeams } from "../lib/mocks";

export function meta() {
  return [{ title: "Component gallery · Auto Soccer" }, { name: "robots", content: "noindex" }];
}

const TOKENS = [
  ["canvas", "#F5F0E8", "Page background"],
  ["surface", "#FFFFFF", "Cards, tables"],
  ["ink", "#20203B", "Text"],
  ["muted", "#77758C", "Secondary (large/non-text)"],
  ["muted-text", "#66647A", "Secondary text, AA"],
  ["coral", "#FF654F", "Brand accent"],
  ["violet", "#6552DD", "Editorial, navigation"],
  ["yellow", "#FFCB45", "Matchweek, leaders"],
  ["match-blue", "#245EFF", "Match-side graphics"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24 border-t border-line pt-8" data-section={id}>
      <h2 id={id} className="mb-4 font-display text-2xl font-extrabold uppercase italic">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Pop Arcade v0.2 component gallery: every shared component and its states, on mock API data. */
export default function Styleguide() {
  return (
    <div className="space-y-10">
      <SectionHeader as="h1" banner eyebrow="Pop Arcade v0.2" title="Component gallery" />
      <Section id="tokens" title="Tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {TOKENS.map(([name, hex, use]) => (
            <li key={name} className="card-surface overflow-hidden">
              <div className="h-14 border-b border-line" style={{ background: `var(--color-${name})` }} />
              <div className="p-2 text-xs">
                <p className="font-semibold">{name}</p>
                <p className="tabular text-muted-text">{hex}</p>
                <p className="text-muted-text">{use}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 card-surface p-4">
          <p className="font-display text-5xl font-extrabold italic uppercase leading-none">Barlow Condensed</p>
          <p className="mt-2">
            Inter for UI and body copy, with tabular numerals:{" "}
            <span className="tabular font-semibold">1 2 3 4 5 – 10 11 12</span>
          </p>
        </div>
      </Section>
      <Section id="ticker" title="ScoreTicker">
        <div className="space-y-3">
          <ScoreTicker fixtures={mockFixtures} matchweek={2} />
          <ScoreTicker fixtures={null} matchweek={null} loading />
          <ScoreTicker fixtures={[]} matchweek={null} />
        </div>
      </Section>
      <Section id="badges" title="TeamBadge & StatusChip">
        <div className="flex flex-wrap items-end gap-6">
          {mockTeams.map((t) => (
            <div key={t.id} className="flex flex-col items-center gap-2 text-xs">
              <TeamBadge team={t} size="xl" />
              <TeamBadge team={t} size="md" />
              <span>{t.name}</span>
            </div>
          ))}
          <div className="flex gap-2">
            {(["completed", "playing", "ready", "scheduled", "failed"] as const).map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </div>
        </div>
      </Section>
      <Section id="match-cards" title="MatchScoreCard & FixtureCard">
        <div className="grid gap-4 md:grid-cols-3">
          {mockFixtures.slice(0, 3).map((f) => (
            <MatchScoreCard key={f.id} fixture={f} />
          ))}
        </div>
        <div className="mt-4 grid gap-2">
          {mockFixtures.map((f) => (
            <FixtureCard key={f.id} fixture={f} />
          ))}
        </div>
      </Section>
      <Section id="standings" title="StandingsTable">
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <StandingsTable rows={mockStandings} caption="League table (mock)" />
          <StandingsTable rows={mockStandings} caption="Compact table (mock)" compact />
          <StandingsTable rows={null} caption="Loading" loading />
          <StandingsTable rows={[]} caption="Empty" />
        </div>
      </Section>
      <Section id="articles" title="ArticleCard, AuthorByline, AgentProfileCard">
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <ArticleCard article={mockArticles[0]!} variant="lead" />
          <div className="grid gap-4">
            <ArticleCard article={mockArticles[1]!} />
            <ArticleCard article={mockArticles[2]!} variant="compact" />
          </div>
          <ArticleCardSkeleton />
          <div className="space-y-3">
            <AuthorByline author={mockJournalists[0]!} publishedAt="2026-11-09T12:30:00.000Z" />
            <AiBadge />
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {mockJournalists.map((j) => (
            <AgentProfileCard key={j.id} agent={{ ...j, href: `/journalists/${j.slug}` }} />
          ))}
        </div>
      </Section>
      <Section id="states" title="Empty & error states">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState title="No stories yet">Articles appear after the first results.</EmptyState>
          <ErrorState>The league API didn't respond. Retrying shortly.</ErrorState>
        </div>
      </Section>
    </div>
  );
}
