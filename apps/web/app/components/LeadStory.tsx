import type { ArticleCardView, Team } from "@autosoccer/contracts";
import { Link } from "react-router";
import { formatDate } from "../lib/format";
import { KIND } from "./ArticleCard";
import { ArticleThumb } from "./ArticleThumb";
import { AiBadge } from "./AuthorByline";
import { Portrait } from "./Portrait";
import { Slashes } from "./SectionHeader";
import { TeamBadge } from "./TeamBadge";

const ROLE = { reporter: "League reporter", analyst: "Tactical analyst", pundit: "League pundit" } as const;

/**
 * Flat-vector hero art: broadcast stripes around the crests of the clubs the story is about.
 * Deliberately graphic, never a depiction of match play (the replay is the only match imagery).
 */
export function HeroArt({
  teams,
  seed,
  kind,
  wide = false,
}: {
  teams: Team[];
  seed: string;
  kind: ArticleCardView["kind"];
  /** Landscape banner (mobile) instead of the tall side panel. */
  wide?: boolean;
}) {
  const [w, h] = wide ? [480, 200] : [320, 480];
  const spots = wide
    ? teams.length === 1
      ? [{ x: 165, y: 15, size: 170 }]
      : [
          { x: 110, y: 10, size: 160 },
          { x: 245, y: 35, size: 145 },
        ]
    : teams.length === 1
      ? [{ x: 60, y: 140, size: 200 }]
      : [
          { x: 30, y: 95, size: 165 },
          { x: 140, y: 255, size: 145 },
        ];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden className="block size-full">
      {wide ? (
        <>
          <path d="M40 0 H90 L50 70 H0 Z" fill="var(--color-yellow)" />
          <path d="M200 0 H300 L190 200 H90 Z" fill="var(--color-violet)" opacity="0.92" />
          <path d="M340 0 H395 L285 200 H230 Z" fill="var(--color-coral)" />
          <path d="M480 40 V200 H390 Z" fill="var(--color-yellow)" opacity="0.9" />
        </>
      ) : (
        <>
          <path d="M120 0 H170 L120 80 H70 Z" fill="var(--color-yellow)" />
          <path d="M215 0 H320 L60 480 H-45 Z" fill="var(--color-violet)" opacity="0.92" />
          <path d="M320 40 V140 L135 480 H80 Z" fill="var(--color-coral)" />
          <path d="M320 260 V480 H200 Z" fill="var(--color-yellow)" opacity="0.9" />
          <path d="M20 400 H60 L40 435 H0 Z" fill="var(--color-coral)" opacity="0.8" />
        </>
      )}
      {teams.length ? (
        teams.slice(0, 2).map((t, i) => {
          const { x, y, size } = spots[i]!;
          return (
            <g key={t.id} transform={`translate(${x} ${y}) rotate(${i ? 7 : -8} ${size / 2} ${size / 2})`}>
              <TeamBadge team={t} size={size} decorative />
            </g>
          );
        })
      ) : (
        <foreignObject x={wide ? 140 : 30} y={wide ? 20 : 150} width={wide ? 210 : 260} height={wide ? 160 : 180}>
          <ArticleThumb seed={seed} kind={kind} className="rounded-xl" />
        </foreignObject>
      )}
    </svg>
  );
}

/** Homepage lead story (mockup "LEAGUE REPORT"): kind tab, oversized headline, byline and hero art. */
export function LeadStory({ article, teams }: { article: ArticleCardView; teams: Team[] }) {
  const about = article.teamIds.map((id) => teams.find((t) => t.id === id)).filter((t): t is Team => !!t);
  return (
    <article className="card-surface relative flex h-full flex-col overflow-hidden" data-testid="lead-story">
      <div className="h-44 sm:absolute sm:inset-y-0 sm:right-0 sm:h-auto sm:w-[38%]">
        <span className="contents sm:hidden">
          <HeroArt teams={about} seed={article.id} kind={article.kind} wide />
        </span>
        <span className="hidden size-full sm:block">
          <HeroArt teams={about} seed={article.id} kind={article.kind} />
        </span>
      </div>
      <div className="relative flex flex-1 flex-col gap-4 p-5 sm:max-w-[62%] sm:p-7">
        <p className="flex items-center gap-1">
          <span className="parallelogram -ml-[0.55em] bg-violet py-1.5 font-display text-xl font-extrabold uppercase italic leading-none text-white sm:text-2xl">
            {KIND[article.kind]}
          </span>
          <Slashes colors={["violet"]} height={30} />
        </p>
        <h2 className="font-display text-[2.5rem] font-extrabold uppercase italic leading-[0.88] tracking-tight sm:text-5xl xl:text-[3.6rem]">
          <Link to={`/news/${article.slug}`} className="underline-offset-4 hover:underline">
            {article.headline}
          </Link>
        </h2>
        <div aria-hidden className="h-2 w-3/4 -skew-x-12 rounded-sm bg-coral" />
        {article.standfirst && <p className="max-w-prose text-lg leading-snug">{article.standfirst}</p>}
        <div className="mt-auto flex items-center gap-3 pt-2">
          <Portrait avatar={article.author.avatar} size={60} rounded="rounded-lg" />
          <div className="min-w-0 leading-tight">
            <p className="flex flex-wrap items-center gap-2">
              <Link
                to={`/journalists/${article.author.slug}`}
                className="font-display text-xl font-extrabold hover:underline"
              >
                {article.author.name}
              </Link>
              <AiBadge />
            </p>
            <p className="text-sm text-muted-text">
              {ROLE[article.author.role]}
              {article.publishedAt && (
                <>
                  {" · "}
                  <time dateTime={article.publishedAt}>{formatDate(article.publishedAt, { time: true })}</time>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}
