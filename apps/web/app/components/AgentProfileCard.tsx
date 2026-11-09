import type { EditorialAgent } from "@autosoccer/contracts";
import { Link } from "react-router";
import { AgentAvatar, AiBadge } from "./AuthorByline";

const ROLE = { reporter: "Match reporter", analyst: "Tactics analyst", pundit: "Pundit", manager: "Manager" } as const;

export interface AgentProfile {
  slug: string;
  name: string;
  role: EditorialAgent["role"] | "manager";
  bio: string;
  avatar: EditorialAgent["avatar"];
  href?: string;
  meta?: string;
}

/** Persistent AI personality (journalist or manager). Always disclosed as AI. */
export function AgentProfileCard({ agent }: { agent: AgentProfile }) {
  return (
    <article className="card-surface flex gap-4 p-4" data-testid="agent-profile-card">
      <AgentAvatar avatar={agent.avatar} size={56} />
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet">{ROLE[agent.role]}</p>
        <h3 className="font-display text-xl font-extrabold leading-tight">
          {agent.href ? (
            <Link to={agent.href} className="hover:underline">
              {agent.name}
            </Link>
          ) : (
            agent.name
          )}
        </h3>
        <p className="mt-1 line-clamp-3 text-sm text-muted-text">{agent.bio}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AiBadge />
          {agent.meta && <span className="text-xs text-muted-text">{agent.meta}</span>}
        </div>
      </div>
    </article>
  );
}
