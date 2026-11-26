/** Read model for a club's finances (club-finances/1). */
import { type ClubFinancesResponse, FINANCES_CONTRACT, type LedgerKind, type Team } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { currentSeason } from "../league/read.ts";
import { RULES } from "./rules.ts";
import { clubPosition, payrollFor, seasonRules } from "./settle.ts";

export async function clubFinances(db: Db, team: Team): Promise<ClubFinancesResponse> {
  const rows = await db<
    {
      kind: LedgerKind;
      amount: string;
      round: number | null;
      memo: string;
      created_at: Date;
      slug: string | null;
      name: string | null;
    }[]
  >`
    select l.kind, l.amount::text, l.round, l.memo, l.created_at, s.slug, s.name
    from club_ledger l left join seasons s on s.id = l.season_id
    where l.team_id = ${team.id}
    order by l.created_at, l.id`;
  const balance = rows.reduce((s, r) => s + Number(r.amount), 0);
  const seasons = new Map<string, ClubFinancesResponse["seasons"][number]>();
  for (const r of rows) {
    if (!r.slug || !r.name) continue;
    const s = seasons.get(r.slug) ?? {
      season: { slug: r.slug, name: r.name },
      bySource: { distribution: 0, results: 0, prize: 0, payroll: 0, transfers: 0, takeover: 0 },
      net: 0,
    };
    const key = r.kind === "result" ? "results" : r.kind === "transfer" ? "transfers" : r.kind;
    if (key !== "opening") s.bySource[key] += Number(r.amount);
    s.net += Number(r.amount);
    seasons.set(r.slug, s);
  }
  const cur = await currentSeason(db);
  const pos = cur ? await clubPosition(db, cur.id, team.id) : null;
  const pay = cur ? await payrollFor(db, cur.id, team.id) : { perRound: 0, players: [] };
  const remaining = pos?.remainingPayroll ?? 0;
  // The current season's numbers (its rule, scaled to its length).
  const R = cur ? await seasonRules(db, cur.id) : RULES;
  return {
    contract: FINANCES_CONTRACT,
    team,
    active: rows.length > 0,
    rule: pos?.rule ?? null,
    balance,
    payroll: { perRound: pay.perRound, players: pay.players.length, roundsToPay: pos?.roundsToPay ?? 0, remaining },
    headroom: balance - remaining,
    seasons: [...seasons.values()],
    entries: [...rows]
      .reverse()
      .slice(0, 12)
      .map((r) => ({
        kind: r.kind,
        season: r.slug && r.name ? { slug: r.slug, name: r.name } : null,
        round: r.round,
        amount: Number(r.amount),
        memo: r.memo,
        at: r.created_at.toISOString(),
      })),
    rules: {
      opening: R.opening,
      distribution: R.distribution,
      result: R.result,
      prize: R.prize,
      wage: {
        base: Math.round(R.wage.base),
        perPoint: Math.round(R.wage.perPoint),
        floor: R.wage.floor,
        min: R.wage.min,
      },
    },
  };
}
