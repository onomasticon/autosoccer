import type { EditorialAgent } from "@autosoccer/contracts";
import { Link } from "react-router";
import { AgentAvatar, AiBadge } from "./AuthorByline";
import { Portrait } from "./Portrait";
import { Slashes } from "./SectionHeader";

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

/** Homepage strip of the league's AI journalists (mockup "VOICES AROUND THE LEAGUE"). */
export function VoicesStrip({ agents }: { agents: AgentProfile[] }) {
  return (
    <section
      aria-labelledby="voices"
      className="card-surface grid overflow-hidden lg:grid-cols-[minmax(15rem,auto)_1fr]"
      data-testid="voices-strip"
    >
      <div className="flex items-center justify-between gap-3 bg-lavender px-6 py-5">
        <h2 id="voices" className="font-display font-extrabold uppercase italic leading-[0.85] tracking-tight">
          <span className="block text-5xl">Voices</span> <span className="block text-2xl">around the league</span>
        </h2>
        <Slashes colors={["violet", "coral", "coral"]} height={44} />
      </div>
      {agents.length ? (
        <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {agents.map((a) => (
            <li key={a.slug} className="flex gap-4 p-4">
              <Portrait avatar={a.avatar} size={88} rounded="rounded-xl" />
              <div className="min-w-0">
                <h3 className="font-display text-2xl font-extrabold leading-none">
                  {a.href ? (
                    <Link to={a.href} className="hover:underline">
                      {a.name}
                    </Link>
                  ) : (
                    a.name
                  )}
                </h3>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-text">
                  {ROLE[a.role]} <AiBadge />
                </p>
                <p className="mt-1.5 line-clamp-3 text-sm">{a.bio}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-5 text-sm text-muted-text">The league's AI reporters, analysts and pundits will appear here.</p>
      )}
    </section>
  );
}
