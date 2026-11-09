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
      className="grid overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] lg:grid-cols-[minmax(17rem,auto)_1fr]"
      data-testid="voices-strip"
    >
      <div className="relative flex items-center bg-lavender px-7 py-6 lg:pr-14 lg:[clip-path:polygon(0_0,100%_0,calc(100%-2.2rem)_100%,0_100%)]">
        <h2 id="voices" className="font-wide font-black uppercase italic leading-[0.86] tracking-tight">
          <span className="flex items-start gap-3 text-[3.2rem]">
            Voices
            <Slashes colors={["violet", "violet-light", "coral"]} height={42} />
          </span>{" "}
          <span className="block font-semi text-[1.55rem] font-extrabold">around the league</span>
        </h2>
      </div>
      {agents.length ? (
        <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-y-0">
          {agents.map((a, i) => (
            <li
              key={a.slug}
              className={`relative flex gap-4 px-5 py-5 ${i ? "sm:before:absolute sm:before:inset-y-6 sm:before:left-0 sm:before:w-px sm:before:bg-ink/15" : ""}`}
            >
              <Portrait avatar={a.avatar} size={96} rounded="rounded-xl" />
              <div className="min-w-0">
                <h3 className="font-semi text-[1.45rem] font-bold leading-none">
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
                <p className="mt-2 line-clamp-3 text-sm leading-snug">{a.bio}</p>
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
