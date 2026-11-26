/**
 * Rescue takeovers (insolvency/1). When a season with a withdrawn club rolls over, new owners take the
 * club over for the next season: they bring its cash back up to the opening balance and rebrand it.
 * The club keeps its id and slug (links and supporter follows), its league slot and squad, and its
 * honours; the old name stays on the seasons it was used in (team_identities).
 *
 * Exactly once: one takeover identity per club per withdrawal season (unique index) and one keyed
 * ledger entry, written in one transaction.
 */
import type { Team } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { type TeamRow, toTeam } from "../mappers.ts";
import { INSOLVENCY, INSOLVENCY_RULE, rebrandName, shortNameFor } from "./rules.ts";

export interface Takeover {
  teamId: string;
  from: string;
  to: string;
  capital: number;
}

const fmt = (n: number) => `${n.toLocaleString("en-GB")} cr`;

/** Takes over every club that withdrew from `fromSeasonId`, for entry to `toSeasonId`. */
export async function rescueClubs(db: Db, fromSeasonId: string, toSeasonId: string): Promise<Takeover[]> {
  const out: Takeover[] = [];
  const gone = await db<{ team_id: string; effective_round: number }[]>`
    select w.team_id, w.effective_round from club_withdrawals w
    join season_teams st on st.season_id = ${toSeasonId} and st.team_id = w.team_id
    where w.season_id = ${fromSeasonId} order by w.declared_at, w.team_id`;
  const [from] = await db<{ name: string }[]>`select name from seasons where id = ${fromSeasonId}`;
  for (const g of gone) {
    const done = await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`takeover:${g.team_id}`}))`;
      const [had] = await tx`
        select 1 from team_identities where team_id = ${g.team_id} and takeover_of_season_id = ${fromSeasonId}`;
      if (had) return null;
      const [team] = await tx<TeamRow[]>`select * from teams where id = ${g.team_id} for update`;
      const used = new Set(
        (
          await tx<{ name: string; short_name: string }[]>`
          select name, short_name from team_identities union select name, short_name from teams`
        ).flatMap((r) => [r.name, r.short_name]),
      );
      const name =
        INSOLVENCY.takeover.names.map((s) => rebrandName(team!.city, s)).find((n) => !used.has(n)) ??
        `${rebrandName(team!.city, INSOLVENCY.takeover.names[0])} ${used.size}`;
      let short = shortNameFor(name);
      for (let i = 2; used.has(short) && i < 10; i++) short = `${shortNameFor(name).slice(0, 3)}${i}`;
      const [bal] = await tx<
        { b: string | null }[]
      >`select sum(amount)::text as b from club_ledger where team_id = ${g.team_id}`;
      const balance = Number(bal?.b ?? 0);
      const capital = Math.max(0, INSOLVENCY.takeover.capitalTo - balance);
      const memo = `Taken over after withdrawing from ${from?.name ?? "the season"} in round ${g.effective_round}. The new owners put in ${fmt(capital)}, bringing the club's cash to ${fmt(balance + capital)}, and renamed ${team!.name} as ${name}.`;
      await tx`
        insert into team_identities (team_id, from_season_id, name, short_name, city, primary_color, secondary_color,
          crest, reason, takeover_of_season_id, memo)
        values (${g.team_id}, ${toSeasonId}, ${name}, ${short}, ${team!.city}, ${team!.primary_color},
          ${team!.secondary_color}, ${tx.json(team!.crest as never)}, 'takeover', ${fromSeasonId}, ${memo})`;
      await tx`update teams set name = ${name}, short_name = ${short} where id = ${g.team_id}`;
      if (capital > 0)
        await tx`
          insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
          values (${g.team_id}, ${toSeasonId}, null, 'takeover', ${capital}, ${`takeover:${fromSeasonId}:${g.team_id}`},
            ${INSOLVENCY_RULE}, ${`Takeover: new owners' capital (as ${name})`},
            ${tx.json({ balanceBefore: balance, capitalTo: INSOLVENCY.takeover.capitalTo, withdrewFrom: fromSeasonId } as never)})
          on conflict (key) do nothing`;
      return { teamId: g.team_id, from: team!.name, to: name, capital };
    });
    if (done) out.push(done);
  }
  return out;
}

/**
 * Clubs as they were known in a season: each club's identity in force then (the latest one from
 * that season or earlier), over its permanent id and slug. Without a season: the current identity.
 */
export async function teamsAsOf(db: Db, seasonId: string | null): Promise<Map<string, Team>> {
  const teams = await db<TeamRow[]>`select * from teams order by name`;
  if (!seasonId) return new Map(teams.map((t) => [t.id, toTeam(t)]));
  const ids = await db<
    {
      team_id: string;
      name: string;
      short_name: string;
      city: string;
      primary_color: string;
      secondary_color: string;
      crest: Team["crest"];
    }[]
  >`
    select distinct on (i.team_id) i.team_id, i.name, i.short_name, i.city, i.primary_color, i.secondary_color, i.crest
    from team_identities i left join seasons fs on fs.id = i.from_season_id
    where i.from_season_id is null
      or fs.created_at <= (select created_at from seasons where id = ${seasonId})
    order by i.team_id, fs.created_at desc nulls last`;
  const as = new Map(ids.map((i) => [i.team_id, i]));
  return new Map(
    teams.map((t) => {
      const i = as.get(t.id);
      return [t.id, toTeam(i ? { ...t, ...i, id: t.id } : t)];
    }),
  );
}
