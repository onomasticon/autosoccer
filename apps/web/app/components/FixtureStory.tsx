import type { FixtureStory, StoryLine } from "@autosoccer/contracts";
import { Link } from "react-router";

/** Short labels for what each line is about. */
const KIND_LABEL: Record<StoryLine["kind"], string> = {
  fixture: "Fixture",
  stakes: "Stakes",
  table: "Table",
  race: "Title race",
  form: "Form",
  meeting: "Head to head",
  history: "History",
  scorers: "Scorers",
  tactics: "Tactics",
  result: "Result",
  goals: "Goals",
  next: "Next",
  transfer: "Transfer",
  takeover: "Takeover",
};

function Line({ line }: { line: StoryLine }) {
  const opinion = line.source === "interpretation";
  return (
    <li className={`grid grid-cols-[6.5rem_1fr] gap-3 py-2 ${opinion ? "rounded-lg bg-lavender/60 px-2" : ""}`}>
      <span className="pt-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-text">
        {opinion ? "Manager's view" : KIND_LABEL[line.kind]}
      </span>
      <span className="text-sm leading-relaxed">
        {line.text}
        {opinion && <span className="block text-xs text-muted-text">AI-written reflection, not fact-checked.</span>}
      </span>
    </li>
  );
}

/**
 * "Why it matters" (before kickoff) or "What changed" (after full time) for one fixture, from the
 * fixture-story/1 read model: official record lines, with the managers' own interpretations
 * labelled as such. Nothing here is generated at render time.
 */
export function StoryCard({
  story,
  mode,
  max,
  headingId,
  as: Heading = "h2",
  collapsed = false,
  linkMatchday = false,
}: {
  story: FixtureStory;
  mode: "before" | "after";
  /** Show at most this many lines (compact placements). */
  max?: number;
  headingId: string;
  as?: "h2" | "h3";
  /** Keep the lines behind a disclosure (e.g. the pre-match story on a finished match). */
  collapsed?: boolean;
  /** Link to the fixture's matchday page (for cards shown elsewhere). */
  linkMatchday?: boolean;
}) {
  const after = mode === "after" && story.postmatch;
  const lines = (after ? story.postmatch!.lines : story.prematch.lines).filter(
    (l) => after || l.kind !== "fixture" || story.prematch.lines.length === 1,
  );
  const shown = max ? lines.slice(0, max) : lines;
  const article = after ? story.articles.report : story.articles.preview;
  const asOf = story.prematch.asOfRound;
  return (
    <section aria-labelledby={headingId} className="card-surface p-4" data-testid={`story-${mode}`}>
      <Heading id={headingId} className="font-display text-lg font-extrabold uppercase italic">
        {after ? "What changed" : "Why it matters"}
      </Heading>
      <p className="mt-0.5 text-xs text-muted-text">
        {after
          ? `From the official record after round ${story.postmatch!.afterRound}.`
          : asOf > 0
            ? `What was on record before kickoff (after round ${asOf}).`
            : "Before kickoff: the season's opening round, so there's no table or form yet."}
      </p>
      {shown.length ? (
        collapsed ? (
          <details className="group mt-2">
            <summary className="cursor-pointer text-sm font-semibold text-violet-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">
              Show {shown.length} line{shown.length === 1 ? "" : "s"} from before kickoff
            </summary>
            <ul className="mt-2 divide-y divide-line">
              {shown.map((l) => (
                <Line key={`${l.kind}:${l.text}`} line={l} />
              ))}
            </ul>
          </details>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {shown.map((l) => (
              <Line key={`${l.kind}:${l.text}`} line={l} />
            ))}
          </ul>
        )
      ) : (
        <p className="mt-3 text-sm text-muted-text">Nothing on record yet for this fixture.</p>
      )}
      {linkMatchday && (
        <p className="mt-3 text-sm">
          <Link
            to={`/matchday/${story.fixtureId}`}
            className="font-semibold text-violet-deep underline-offset-4 hover:underline"
          >
            Open the matchday <span aria-hidden>→</span>
          </Link>
        </p>
      )}
      {article && (
        <p className="mt-3 text-sm">
          <Link
            to={`/news/${article.slug}`}
            className="font-semibold text-violet-deep underline-offset-4 hover:underline"
          >
            {/^(preview|match report)\b/i.test(article.headline)
              ? article.headline
              : `${after ? "Match report" : "Preview"}: ${article.headline}`}
          </Link>
        </p>
      )}
    </section>
  );
}
