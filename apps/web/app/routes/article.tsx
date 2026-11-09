import type { ArticleDetailResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { ArticleCard } from "../components/ArticleCard";
import { ArticleThumb } from "../components/ArticleThumb";
import { AuthorByline } from "../components/AuthorByline";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/article";

export async function loader({ params }: Route.LoaderArgs) {
  return apiOr404<ArticleDetailResponse>(`/api/v1/articles/${encodeURIComponent(params.slug)}`);
}

export const meta: Route.MetaFunction = ({ data }) =>
  data
    ? seo(data.article.headline, data.article.standfirst, [
        { property: "og:type", content: "article" },
        { name: "author", content: `${data.author.name} (AI)` },
      ])
    : seo("Article not found");

const KIND = { match_report: "Match report", preview: "Preview", analysis: "Analysis", column: "Opinion" } as const;

/** Where a cited fact lives on the site. */
function factLink(factId: string): string | null {
  const m = /^match:([0-9a-f-]{36}):/.exec(factId);
  if (m) return `/matches/${m[1]}`;
  if (factId.startsWith("standing:")) return "/table";
  return null;
}

export default function ArticlePage({ loaderData }: Route.ComponentProps) {
  const { article, author, related } = loaderData;
  const paragraphs = article.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className="space-y-10">
      <article className="mx-auto max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet">{KIND[article.kind]}</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold leading-[1.05] sm:text-5xl">{article.headline}</h1>
        {article.standfirst && <p className="mt-3 text-xl text-muted-text">{article.standfirst}</p>}
        <div className="mt-5 border-y border-line py-4">
          <AuthorByline author={author} publishedAt={article.publishedAt} />
        </div>
        <ArticleThumb seed={article.id} kind={article.kind} className="mt-6 aspect-[16/7] rounded-xl" />
        <aside
          className="mt-6 rounded-xl border border-violet/30 bg-surface p-4 text-sm"
          aria-label="About this article"
        >
          <p>
            <strong>Written by an AI journalist.</strong> {author.name} is an AI {author.role} for Auto Soccer. This
            article was generated after the match from the league's official record and automatically fact-checked:
            every score must match the record, and no quotes are allowed because nobody is interviewed.
          </p>
        </aside>
        <div
          className="mt-8 space-y-5 bg-surface p-6 text-lg leading-relaxed sm:rounded-xl sm:p-8"
          data-testid="article-body"
        >
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {article.matchId && (
            <p>
              <Link
                to={`/matches/${article.matchId}`}
                className="font-semibold text-violet underline underline-offset-4"
              >
                Watch the replay and full statistics in the match centre →
              </Link>
            </p>
          )}
        </div>
        <section aria-labelledby="sources" className="mt-8">
          <h2 id="sources" className="font-display text-2xl font-extrabold uppercase italic">
            Sources
          </h2>
          <p className="mt-1 text-sm text-muted-text">Each claim and the official record it comes from.</p>
          <ol className="mt-3 space-y-2 text-sm">
            {article.citations.map((c, i) => {
              const href = factLink(c.factId);
              return (
                <li key={`${c.factId}-${i}`} className="card-surface px-4 py-2.5">
                  <span>{c.text}</span>
                  <span className="mt-0.5 block text-xs text-muted-text">
                    Official record:{" "}
                    {href ? (
                      <Link to={href} className="font-mono underline">
                        {c.factId.replace(/[0-9a-f-]{36}/g, (u) => u.slice(0, 8))}
                      </Link>
                    ) : (
                      <span className="font-mono">{c.factId}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </article>
      {related.length > 0 && (
        <section aria-labelledby="related" className="mx-auto max-w-5xl">
          <SectionHeader id="related" title="Related stories" />
          <div className="grid gap-4 sm:grid-cols-3">
            {related.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Article" />;
}
