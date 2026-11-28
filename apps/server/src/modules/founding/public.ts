/** How a league began (inaugural/1), as its public page shows it: official records only. */
import type { LeagueFounding, Team } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { seasonTeams } from "../league/read.ts";
import { type TeamRow, toTeam } from "../mappers.ts";
import { modelBySlug } from "../models/registry.ts";

export async function leagueFounding(db: Db, leagueId: string): Promise<LeagueFounding | null> {
  const [l] = await db<{ inaugural: { rule: string; opens: string } | null; inaugural_season_id: string | null }[]>`
    select inaugural, inaugural_season_id from leagues where id = ${leagueId}`;
  if (!l?.inaugural) return null;
  const founders = await db<
    {
      model: string;
      status: "invited" | "founded" | "awaiting";
      rounds: number;
      team_id: string | null;
      live: boolean | null;
    }[]
  >`
    select f.model, f.status, f.rounds, f.team_id, (c.provenance->>'live')::boolean as live
    from founders f left join club_charters c on c.founder_id = f.id
    where f.league_id = ${leagueId} order by f.status = 'founded' desc, f.model`;
  const asKnown = l.inaugural_season_id ? await seasonTeams(db, l.inaugural_season_id) : new Map<string, Team>();
  const team = async (id: string | null): Promise<Team | null> => {
    if (!id) return null;
    const known = asKnown.get(id);
    if (known) return known;
    const [t] = await db<TeamRow[]>`select * from teams where id = ${id}`;
    return t ? toTeam(t) : null;
  };
  let recruitment: LeagueFounding["recruitment"] = null;
  if (l.inaugural_season_id) {
    const [r] = await db<{ rounds: number; recruited: number; net: number }[]>`
      select (select count(*) from market_windows where season_id = ${l.inaugural_season_id} and kind = 'recruitment' and phase = 'closed')::int as rounds,
        (select count(*) from free_agent_offers o join market_windows w on w.id = o.window_id
          where w.season_id = ${l.inaugural_season_id} and w.kind = 'recruitment' and o.outcome = 'signed')::int as recruited,
        (select count(*) from club_ledger where season_id = ${l.inaugural_season_id} and kind = 'recruitment')::int as net`;
    recruitment = { rounds: r!.rounds, recruited: r!.recruited, safetyNet: r!.net };
  }
  return {
    rule: l.inaugural.rule,
    opensAt: new Date(l.inaugural.opens).toISOString(),
    founders: await Promise.all(
      founders.map(async (f) => {
        const spec = modelBySlug(f.model);
        return {
          model: {
            slug: f.model,
            provider: spec?.provider ?? "unknown",
            apiModelId: spec?.apiModelId ?? f.model,
            route: spec?.route ?? "direct",
            host: spec?.host?.name ?? null,
          },
          status: f.status,
          rounds: f.rounds,
          team: await team(f.team_id),
          live: f.live,
        };
      }),
    ),
    recruitment,
  };
}
