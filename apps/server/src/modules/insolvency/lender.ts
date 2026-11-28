/**
 * The league lender in the database (insolvency/2, #97), for seasons whose insolvency_rule is
 * 'insolvency/2'. The rule numbers and decisions are the pure functions in recovery.ts, the same ones
 * the economy harness calibrated; this module applies them to the club ledger, exactly once.
 *
 * Before each round (advanceSeason), every club must be able to meet the round's obligations: its
 * contract wages, running costs and loan instalments. A club that can't:
 *  1. borrows emergency financing, if the shortfall fits under its debt cap and it isn't administered;
 *  2. otherwise defaults: the lender auctions its players one at a time (compulsory sealed bids from
 *     every eligible club; never below the minimum squad or the last keeper), applies the proceeds
 *     senior-first, puts the club into administration if its debt is still high, and lends repayable
 *     support for whatever is still short.
 * The round's wages are always covered, so every fixture is played. Nothing is given away.
 *
 * At season end interest accrues; an administered club's surplus is swept to the lender, and it leaves
 * administration once its debt and cash allow.
 *
 * Auction bids follow a fixed league rule for now (a club bids when the player would play for it and it
 * can afford him with three rounds of wages in hand). A manager auction tool is the next step.
 */
import type { TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { FINANCE_3 } from "../finance/rules.ts";
import { contractPayroll } from "../finance/settle.ts";
import { overallRating, playerAttributes } from "../league/attributes.ts";
import { seasonNumber } from "../league/rollover.ts";
import { guideFee } from "../transfers/rules.ts";
import { repairLineup } from "../transfers/settle.ts";
import {
  auctionWinner,
  canExitAdministration,
  collateralValue,
  debtCap,
  emergencyFinancing,
  INSOLVENCY_2,
  INSOLVENCY_2_RULE,
  instalment,
  interestFor,
  type LoanLike,
  securedCapacity,
  waterfall,
} from "./recovery.ts";

const SQUAD_MIN = 9;
const SQUAD_MAX = 16;

interface Season {
  id: string;
  number: number;
  rounds: number;
  finance_rule: string | null;
}

async function season(db: Db, seasonId: string): Promise<Season | null> {
  const [s] = await db<
    { id: string; slug: string; rounds: number; insolvency_rule: string | null; finance_rule: string | null }[]
  >`
    select s.id, s.slug, s.insolvency_rule, s.finance_rule,
      coalesce((select max(round) from fixtures f where f.season_id = s.id), 0)::int as rounds
    from seasons s where s.id = ${seasonId}`;
  if (!s || s.insolvency_rule !== INSOLVENCY_2_RULE) return null;
  return { id: s.id, number: seasonNumber(s.slug) ?? 1, rounds: Math.max(1, s.rounds), finance_rule: s.finance_rule };
}

const cashOf = async (db: Db, teamId: string) =>
  Number(
    (
      await db<{ n: string }[]>`select coalesce(sum(amount), 0)::text as n from club_ledger where team_id = ${teamId}`
    )[0]!.n,
  );

export async function loansOf(db: Db, teamId: string): Promise<LoanLike[]> {
  const rows = await db<
    { id: string; kind: LoanLike["kind"]; balance: string; due_season: number; liens: string[] | null }[]
  >`
    select l.id, l.kind, coalesce((select sum(e.amount) from loan_entries e where e.loan_id = l.id), 0)::text as balance, l.due_season,
      (select array_agg(player_id) from loan_liens n where n.loan_id = l.id and n.released_at is null) as liens
    from club_loans l where l.team_id = ${teamId} and l.status = 'active' order by l.created_at, l.id`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    balance: Number(r.balance),
    dueSeason: r.due_season,
    collateral: r.liens ?? [],
  }));
}

export const debtOf = async (db: Db, teamId: string) => (await loansOf(db, teamId)).reduce((s, l) => s + l.balance, 0);

const administered = async (db: Db, teamId: string) =>
  !!(await db`select 1 from administrations where team_id = ${teamId} and exited_at is null`)[0];

const operatingPerRound = (s: Season) =>
  s.finance_rule === "finance/3" ? Math.round(FINANCE_3.operatingPerSeason / s.rounds) : 0;

async function openLoan(
  db: Db,
  s: Season,
  teamId: string,
  kind: LoanLike["kind"],
  amount: number,
  round: number | null,
  liens: string[] = [],
): Promise<string> {
  const term =
    kind === "secured"
      ? INSOLVENCY_2.secured.termSeasons
      : kind === "emergency"
        ? INSOLVENCY_2.emergency.termSeasons
        : 3;
  const [loan] = await db<{ id: string }[]>`
    insert into club_loans (team_id, season_id, opened_round, kind, principal, due_season, rule)
    values (${teamId}, ${s.id}, ${round}, ${kind}, ${amount}, ${s.number + term - 1}, ${INSOLVENCY_2_RULE}) returning id`;
  const id = loan!.id;
  await db`insert into loan_entries (loan_id, season_id, round, kind, amount, key) values (${id}, ${s.id}, ${round}, 'disbursement', ${amount}, ${`disburse:${id}`})`;
  await db`insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
    values (${teamId}, ${s.id}, ${round}, 'loan', ${amount}, ${`loan:${id}`}, ${INSOLVENCY_2_RULE},
      ${`${kind[0]!.toUpperCase()}${kind.slice(1)} loan`}, ${db.json({ loan: id, kind })})`;
  for (const p of liens) await db`insert into loan_liens (loan_id, player_id) values (${id}, ${p})`;
  return id;
}

/** Pays `amount` (at most the club's cash) to its loans, most senior first. Closes and un-pledges repaid loans. */
async function repay(db: Db, s: Season, teamId: string, amount: number, round: number | null, tag: string) {
  const cash = await cashOf(db, teamId);
  const loans = await loansOf(db, teamId);
  const { repaid } = waterfall(Math.min(amount, Math.max(0, cash)), loans);
  for (const r of repaid) {
    const key = `repay:${r.id}:${s.id}:${round ?? "end"}:${tag}`;
    const ins = await db`insert into loan_entries (loan_id, season_id, round, kind, amount, key)
      values (${r.id}, ${s.id}, ${round}, 'repayment', ${-r.amount}, ${key}) on conflict (key) do nothing`;
    if (!ins.count) continue;
    await db`insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
      values (${teamId}, ${s.id}, ${round}, 'repayment', ${-r.amount}, ${key}, ${INSOLVENCY_2_RULE}, 'Loan repayment', ${db.json({ loan: r.id, tag })})`;
  }
  await closeRepaid(db, teamId);
}

async function closeRepaid(db: Db, teamId: string) {
  for (const l of await loansOf(db, teamId))
    if (l.balance <= 0) {
      await db`update club_loans set status = 'repaid', closed_at = now() where id = ${l.id}`;
      await db`update loan_liens set released_at = now() where loan_id = ${l.id} and released_at is null`;
    }
}

interface SquadPlayer {
  id: string;
  name: string;
  position: string;
  overall: number;
  wage: number;
}

async function squadOf(db: Db, s: Season, teamId: string): Promise<SquadPlayer[]> {
  const rows = await db<
    {
      id: string;
      name: string;
      position: "GK" | "DF" | "MF" | "FW";
      shirt_number: number;
      attributes: never;
      wage: string | null;
    }[]
  >`
    select p.id, p.name, p.position, p.shirt_number, r.attributes,
      (select c.wage_per_season::text from player_contracts c where c.player_id = p.id and c.status = 'active' limit 1) as wage
    from players p left join player_ratings r on r.player_id = p.id and r.season_id = ${s.id}
    where p.team_id = ${teamId} and p.retired_season_id is null order by p.id`;
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    overall: overallRating(
      p.attributes ?? playerAttributes({ name: p.name, shirtNumber: p.shirt_number, position: p.position }),
      p.position,
    ),
    wage: Number(p.wage ?? 0),
  }));
}

/** Who the lender may sell, most expensive first: never below the minimum squad or the last keeper. */
function sellable(squad: SquadPlayer[]): SquadPlayer[] {
  if (squad.length <= SQUAD_MIN) return [];
  const keepers = squad.filter((p) => p.position === "GK").length;
  return squad
    .filter((p) => p.position !== "GK" || keepers > 1)
    .sort((a, b) => b.wage - a.wage || b.overall - a.overall || a.id.localeCompare(b.id));
}

/**
 * One compulsory sealed-bid auction. Every eligible club bids once (league rule, see above); the
 * winner pays the seller, takes the player's contract and registration from this round, and the
 * proceeds go to the seller's lender. Returns whether the player was sold.
 */
async function auction(db: Db, s: Season, sellerId: string, p: SquadPlayer, round: number): Promise<boolean> {
  const guide = guideFee(p.overall, 0);
  const teams = await db<
    { team_id: string }[]
  >`select team_id from season_teams where season_id = ${s.id} order by team_id`;
  const bids: Array<{ club: string; amount: number }> = [];
  for (const { team_id } of teams) {
    if (team_id === sellerId || (await administered(db, team_id))) continue;
    if ((await loansOf(db, team_id)).some((l) => l.kind === "emergency")) continue;
    const squad = await squadOf(db, s, team_id);
    if (squad.length >= SQUAD_MAX) continue;
    const same = squad.filter((x) => x.position === p.position).sort((a, b) => b.overall - a.overall);
    const weakestStarter = same[p.position === "GK" ? 0 : Math.min(1, same.length - 1)];
    if (weakestStarter && p.overall < weakestStarter.overall - 2) continue;
    const bill = (await contractPayroll(db, s.id, team_id, round)).perRound;
    const spare = (await cashOf(db, team_id)) - 3 * bill;
    const amount = Math.min(spare, Math.round((guide * 0.6) / 10_000) * 10_000);
    if (amount > 0) bids.push({ club: team_id, amount });
  }
  const win = auctionWinner(bids, guide);
  const key = `auction:${s.id}:${round}:${p.id}`;
  await db`insert into collateral_auctions (season_id, round, seller_team_id, player_id, reserve, bids, winner_team_id, amount, status, key)
    values (${s.id}, ${round}, ${sellerId}, ${p.id}, ${Math.ceil(guide * INSOLVENCY_2.auction.reserve)}, ${db.json(bids)},
      ${win?.club ?? null}, ${win?.amount ?? null}, ${win ? "sold" : "failed"}, ${key}) on conflict (key) do nothing`;
  if (!win) return false;
  await db`insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis) values
    (${win.club}, ${s.id}, ${round}, 'auction', ${-win.amount}, ${`${key}:buyer`}, ${INSOLVENCY_2_RULE}, ${`Bought ${p.name} at the lender's auction`}, ${db.json({ player: p.id })}),
    (${sellerId}, ${s.id}, ${round}, 'auction', ${win.amount}, ${`${key}:seller`}, ${INSOLVENCY_2_RULE}, ${`${p.name} sold at the lender's auction`}, ${db.json({ player: p.id })})`;
  const [shirt] = await db<{ n: number }[]>`
    select min(n)::int as n from generate_series(1, 99) n where n not in (select shirt_number from players where team_id = ${win.club})`;
  await db`update players set team_id = ${win.club}, shirt_number = ${shirt!.n} where id = ${p.id}`;
  // The contract moves with him, at the same wage and term.
  const [c] = await db<{ wage_per_season: string; ends_season: number }[]>`
    select wage_per_season::text, ends_season from player_contracts where player_id = ${p.id} and status = 'active'`;
  await db`update player_contracts set status = 'transferred', ended_at = now() where player_id = ${p.id} and status = 'active'`;
  if (c)
    await db`insert into player_contracts (player_id, team_id, season_id, wage_per_season, starts_season, ends_season, via, rule)
      values (${p.id}, ${win.club}, ${s.id}, ${c.wage_per_season}, ${s.number}, ${Math.max(s.number, c.ends_season)}, 'transfer', ${INSOLVENCY_2_RULE})`;
  if (round <= 1)
    await db`update player_registrations set team_id = ${win.club} where season_id = ${s.id} and player_id = ${p.id}`;
  else
    await db`insert into registration_moves (season_id, player_id, from_round, from_team_id, to_team_id, via)
      values (${s.id}, ${p.id}, ${round}, ${sellerId}, ${win.club}, 'transfer') on conflict do nothing`;
  await db`update loan_liens set released_at = now() where player_id = ${p.id} and released_at is null`;
  await repay(db, s, sellerId, win.amount, round, `auction:${p.id}`);
  return true;
}

export interface LenderCheck {
  teamId: string;
  outcome: "solvent" | "emergency" | "default";
  shortfall: number;
}

/**
 * The lender's check before a round (idempotent: once per club per round). Makes sure every club can
 * meet the round's wages, running costs and instalments, then takes the instalments.
 */
export async function lenderRound(db: Db, seasonId: string, round: number): Promise<LenderCheck[]> {
  const s = await season(db, seasonId);
  if (!s) return [];
  const teams = await db<
    { team_id: string }[]
  >`select team_id from season_teams where season_id = ${seasonId} order by team_id`;
  const out: LenderCheck[] = [];
  const moved = new Set<string>();
  for (const { team_id } of teams) {
    const done = await db.begin(async (tx) => {
      const t = tx as unknown as Db;
      const [mark] =
        await t`select 1 from lender_checks where season_id = ${seasonId} and team_id = ${team_id} and round = ${round} for update`;
      if (mark) return null;
      const payroll = (await contractPayroll(t, seasonId, team_id, round)).perRound;
      const seasonBill = payroll * s.rounds;
      const loans = await loansOf(t, team_id);
      const instalments = loans.map((l) => ({ l, due: instalment(l, s.number, s.rounds - round + 1, s.rounds) }));
      const obligations = payroll + operatingPerRound(s) + instalments.reduce((a, x) => a + x.due, 0);
      const [paid] = await t`select 1 from club_ledger where key = ${`distribution:${seasonId}:${team_id}`}`;
      // Round 1's distribution is paid as the round kicks off, so it counts towards its obligations.
      const due = round === 1 && !paid ? distributionOf(s) : 0;
      const cash = await cashOf(t, team_id);
      const shortfall = obligations - (cash + due);
      let outcome: LenderCheck["outcome"] = "solvent";
      const basis: Record<string, unknown> = {
        payroll,
        operating: operatingPerRound(s),
        instalments: instalments.map((x) => x.due),
        cash,
        due,
      };
      if (shortfall > 0) {
        const debt = loans.reduce((a, l) => a + l.balance, 0);
        const emergency = emergencyFinancing(shortfall, debt, seasonBill, await administered(t, team_id));
        if (emergency !== null) {
          outcome = "emergency";
          await openLoan(t, s, team_id, "emergency", emergency, round);
        } else {
          outcome = "default";
          const sold: string[] = [];
          for (;;) {
            const enough =
              (await debtOf(t, team_id)) <= debtCap(seasonBill) && (await cashOf(t, team_id)) + due >= obligations;
            if (enough) break;
            const next = sellable(await squadOf(t, s, team_id)).find((p) => !sold.includes(p.id));
            if (!next) break;
            sold.push(next.id);
            if (await auction(t, s, team_id, next, round)) moved.add(team_id);
          }
          basis.auctioned = sold;
          const debtNow = await debtOf(t, team_id);
          if (
            !(await administered(t, team_id)) &&
            debtNow > INSOLVENCY_2.administration.exitDebtShare * debtCap(seasonBill)
          )
            await t`insert into administrations (team_id, entered_season_id, entered_round, debt_at_entry, reason)
              values (${team_id}, ${seasonId}, ${round}, ${debtNow}, ${`Couldn't meet round ${round}'s obligations within its debt cap`})`;
          const still = obligations - ((await cashOf(t, team_id)) + due);
          if (still > 0) await openLoan(t, s, team_id, "support", still, round);
        }
      }
      // Take this round's instalments (the money is there now).
      for (const { l, due: amount } of instalments) {
        if (amount <= 0) continue;
        const key = `instalment:${l.id}:${seasonId}:${round}`;
        const ins = await t`insert into loan_entries (loan_id, season_id, round, kind, amount, key)
          values (${l.id}, ${seasonId}, ${round}, 'repayment', ${-amount}, ${key}) on conflict (key) do nothing`;
        if (ins.count)
          await t`insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
            values (${team_id}, ${seasonId}, ${round}, 'repayment', ${-amount}, ${key}, ${INSOLVENCY_2_RULE}, ${`Loan instalment, round ${round}`}, ${t.json({ loan: l.id })})`;
      }
      await closeRepaid(t, team_id);
      await t`insert into lender_checks (season_id, team_id, round, outcome, basis) values (${seasonId}, ${team_id}, ${round}, ${outcome}, ${t.json(basis as never)})`;
      return { teamId: team_id, outcome, shortfall: Math.max(0, shortfall) };
    });
    if (done) out.push(done);
  }
  // Auctions change squads: keep every affected club's lineup valid for the round.
  if (moved.size) {
    const [sz] = await db<{ players_per_team: number }[]>`select players_per_team from seasons where id = ${seasonId}`;
    for (const { team_id } of teams)
      await repairLineup(db, seasonId, team_id, sz!.players_per_team as TeamSize, { in: [], out: [] });
  }
  return out;
}

const distributionOf = (s: Season) => (s.finance_rule === "finance/3" ? FINANCE_3.distribution : 0);

/**
 * Season end: interest on every loan, an administered club's surplus swept to the lender, and its exit
 * from administration once its debt is at most half its cap and it holds three rounds of wages.
 * Idempotent (keys per loan or club and season).
 */
export async function lenderSeasonEnd(db: Db, seasonId: string): Promise<void> {
  const s = await season(db, seasonId);
  if (!s) return;
  const teams = await db<
    { team_id: string }[]
  >`select team_id from season_teams where season_id = ${seasonId} order by team_id`;
  for (const { team_id } of teams)
    await db.begin(async (tx) => {
      const t = tx as unknown as Db;
      for (const l of await loansOf(t, team_id)) {
        const amount = Math.round(l.balance * interestFor(l.kind));
        if (amount > 0)
          await t`insert into loan_entries (loan_id, season_id, kind, amount, key)
            values (${l.id}, ${seasonId}, 'interest', ${amount}, ${`interest:${l.id}:${seasonId}`}) on conflict (key) do nothing`;
      }
      if (!(await administered(t, team_id))) return;
      const bill = (await contractPayroll(t, seasonId, team_id, s.rounds)).perRound;
      const surplus = (await cashOf(t, team_id)) - INSOLVENCY_2.administration.cashRounds * bill;
      if (surplus > 0) await repay(t, s, team_id, surplus, null, "sweep");
      if (canExitAdministration(await debtOf(t, team_id), await cashOf(t, team_id), bill, bill * s.rounds))
        await t`update administrations set exited_season_id = ${seasonId}, exited_at = now() where team_id = ${team_id} and exited_at is null`;
    });
}

/**
 * A secured loan a club asks for, against contracted players it pledges: at most the loan-to-value of
 * their conservative value, within the debt cap; a player can't be pledged twice or beyond his
 * contract. Not available in administration or with emergency financing outstanding.
 */
export async function borrowSecured(
  db: Db,
  seasonId: string,
  teamId: string,
  amount: number,
  playerIds: string[],
): Promise<{ ok: true; loanId: string } | { ok: false; reason: string }> {
  const s = await season(db, seasonId);
  if (!s) return { ok: false, reason: "this season has no lender" };
  return db.begin(async (tx) => {
    const t = tx as unknown as Db;
    if (await administered(t, teamId)) return { ok: false as const, reason: "the club is in administration" };
    const loans = await loansOf(t, teamId);
    if (loans.some((l) => l.kind === "emergency"))
      return { ok: false as const, reason: "emergency financing is outstanding" };
    const until = s.number + INSOLVENCY_2.secured.termSeasons - 1;
    const squad = await squadOf(t, s, teamId);
    let value = 0;
    for (const id of playerIds) {
      const p = squad.find((x) => x.id === id);
      if (!p) return { ok: false as const, reason: `${id} isn't at the club` };
      const [c] = await t<
        { ends_season: number }[]
      >`select ends_season from player_contracts where player_id = ${id} and status = 'active'`;
      const [lien] = await t`select 1 from loan_liens where player_id = ${id} and released_at is null`;
      const v = collateralValue(
        { guideFee: guideFee(p.overall, 0), contractUntil: c?.ends_season ?? 0, pledged: !!lien },
        until,
      );
      if (!v)
        return {
          ok: false as const,
          reason: `${p.name} can't be pledged (already pledged, or his contract ends before the loan)`,
        };
      value += v;
    }
    const bill = (await contractPayroll(t, seasonId, teamId, 1)).perRound * s.rounds;
    const capacity = securedCapacity(
      value,
      loans.reduce((a, l) => a + l.balance, 0),
      bill,
    );
    if (amount <= 0 || amount > capacity)
      return { ok: false as const, reason: `at most Ȼ${capacity.toLocaleString("en-GB")} against that collateral` };
    return { ok: true as const, loanId: await openLoan(t, s, teamId, "secured", amount, null, playerIds) };
  });
}
