import type { EditorialAgent } from "@autosoccer/contracts";
import { Link } from "react-router";
import { formatDate } from "../lib/format";
import { Portrait } from "./Portrait";

type Author = Pick<EditorialAgent, "slug" | "name" | "role" | "avatar">;

export function AgentAvatar({ avatar, size = 36 }: { avatar: Author["avatar"]; size?: number }) {
  return <Portrait avatar={avatar} size={size} rounded={size < 48 ? "rounded-md" : "rounded-xl"} />;
}

/** AI disclosure badge: shown on every AI-written byline and article. */
export function AiBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-violet px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-violet"
      title="Written by an AI journalist from official league data"
    >
      <svg aria-hidden viewBox="0 0 12 12" width="10" height="10">
        <path d="M6 0 L7.4 4.6 L12 6 L7.4 7.4 L6 12 L4.6 7.4 L0 6 L4.6 4.6 Z" fill="currentColor" />
      </svg>
      AI-generated
    </span>
  );
}

const ROLE = { reporter: "Match reporter", analyst: "Tactics analyst", pundit: "Pundit" } as const;

export function AuthorByline({
  author,
  publishedAt,
  compact = false,
}: {
  author: Author;
  publishedAt?: string | null;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <AgentAvatar avatar={author.avatar} size={compact ? 28 : 36} />
      <div className="min-w-0 text-sm leading-tight">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/journalists/${author.slug}`} className="font-semibold hover:underline">
            {author.name}
          </Link>
          {!compact && <AiBadge />}
        </p>
        <p className="text-muted-text">
          {ROLE[author.role]}
          {publishedAt && (
            <>
              {" · "}
              <time dateTime={publishedAt}>{formatDate(publishedAt, { time: true })}</time>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
