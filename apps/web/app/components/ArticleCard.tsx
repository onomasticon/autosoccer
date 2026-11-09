import type { ArticleCardView } from "@autosoccer/contracts";
import { Link } from "react-router";
import { ArticleThumb } from "./ArticleThumb";
import { AuthorByline } from "./AuthorByline";
import { Loading, Skeleton } from "./States";

export type ArticleCardData = ArticleCardView;

const KIND = { match_report: "Match report", preview: "Preview", analysis: "Analysis", column: "Column" } as const;

export function ArticleCard({
  article,
  variant = "standard",
}: {
  article: ArticleCardData;
  variant?: "standard" | "lead" | "compact";
}) {
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
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet">{KIND[article.kind]}</p>
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
