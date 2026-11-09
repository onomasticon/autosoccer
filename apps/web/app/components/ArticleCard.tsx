import type { ArticleCardView } from "@autosoccer/contracts";
import { Link } from "react-router";
import { formatDate } from "../lib/format";
import { ArticleThumb } from "./ArticleThumb";
import { AuthorByline } from "./AuthorByline";
import { Loading, Skeleton } from "./States";

export type ArticleCardData = ArticleCardView;

export const KIND = {
  match_report: "Match report",
  preview: "Preview",
  analysis: "Tactical analysis",
  column: "Opinion",
} as const;

const TAG_TONE: Record<ArticleCardView["kind"], string> = {
  match_report: "bg-lavender text-violet-deep",
  preview: "bg-lavender text-violet-deep",
  analysis: "bg-yellow text-ink",
  column: "bg-coral/25 text-ink",
};

/** Small highlighted category label (mockup "TACTICAL ANALYSIS"). Text, so never colour-only. */
export function KindTag({ kind }: { kind: ArticleCardView["kind"] }) {
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 font-semi text-sm font-extrabold uppercase italic leading-none tracking-wide ${TAG_TONE[kind]}`}
    >
      {KIND[kind]}
    </span>
  );
}

export function ArticleCard({
  article,
  variant = "standard",
}: {
  article: ArticleCardData;
  variant?: "standard" | "lead" | "compact" | "row";
}) {
  if (variant === "row")
    return (
      <article className="group flex gap-3 sm:gap-4" data-testid="article-card">
        <div className="w-28 shrink-0 self-start overflow-hidden rounded-lg sm:w-36">
          <ArticleThumb seed={article.id} kind={article.kind} className="aspect-[4/3]" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p>
            <KindTag kind={article.kind} />
          </p>
          <h3 className="font-semi text-lg font-bold leading-[1.12] sm:text-[1.3rem]">
            <Link to={`/news/${article.slug}`} className="underline-offset-4 hover:underline">
              {article.headline}
            </Link>
          </h3>
          <p className="text-sm text-muted-text">
            <Link to={`/journalists/${article.author.slug}`} className="hover:underline">
              {article.author.name}
            </Link>
            {article.publishedAt && (
              <>
                {" · "}
                <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
              </>
            )}
            <span className="sr-only"> (AI-generated)</span>
          </p>
        </div>
      </article>
    );
  const lead = variant === "lead";
  return (
    <article
      className={`card-surface group flex overflow-hidden ${variant === "compact" ? "flex-row items-stretch" : "flex-col"}`}
      data-testid="article-card"
    >
      {variant !== "compact" && (
        <ArticleThumb seed={article.id} kind={article.kind} className={lead ? "aspect-[16/8]" : "aspect-[16/9]"} />
      )}
      <div className={`flex flex-1 flex-col gap-2 ${lead ? "p-6" : "p-4"}`}>
        <p>
          <KindTag kind={article.kind} />
        </p>
        <h3 className={`font-display font-extrabold leading-tight ${lead ? "text-3xl sm:text-4xl" : "text-xl"}`}>
          <Link to={`/news/${article.slug}`} className="underline-offset-4 hover:underline">
            {article.headline}
          </Link>
        </h3>
        {variant !== "compact" && article.standfirst && (
          <p className={`text-muted-text ${lead ? "text-lg" : "text-sm"}`}>{article.standfirst}</p>
        )}
        <div className="relative z-10 mt-auto pt-2">
          <AuthorByline author={article.author} publishedAt={article.publishedAt} compact={variant === "compact"} />
        </div>
      </div>
    </article>
  );
}

export function ArticleCardSkeleton() {
  return (
    <Loading label="Loading stories">
      <div className="card-surface space-y-3 p-4">
        <Skeleton className="aspect-[16/9] w-full" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-4 w-full" />
      </div>
    </Loading>
  );
}
