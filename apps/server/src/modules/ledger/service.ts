/**
 * Compute ledger: USD-equivalent budgets kept as an append-only list of integer micro-USD
 * transactions. Each season has one account per team (managers, pool 'team') and one for the
 * newsroom (journalists, pool 'editorial', no team). Balance = Σ amount.
 *   grant   +budget          once per account, created lazily
 *   reserve −estimate        before a model call (worst case)
 *   release +unused hold     when the call finishes or fails
 *   charge  −actual cost     what the call really cost (tokens × price)
 * All mutations for an account run under a Postgres advisory lock, so concurrent agent runs
 * can't overspend: a reservation succeeds only if the balance covers it.
 */
import type { Db } from "@autosoccer/db";
import type postgres from "postgres";
import { type ComputeGate, worstCaseDecisionMicroUsd } from "../agents/service.ts";

type Tx = postgres.TransactionSql;

/** A ledger account: one team's season budget, or the season's editorial (journalist) budget. */
type Account = { seasonId: string; teamId: string } | { seasonId: string; teamId: null };
const poolOf = (a: Account) => (a.teamId === null ? "editorial" : "team");

const lockAccount = (tx: Tx, a: Account) =>
  tx`select pg_advisory_xact_lock(hashtext(${`ledger:${a.seasonId}:${a.teamId ?? "editorial"}`}))`;

async function ensureGrant(tx: Tx, a: Account) {
  if (a.teamId === null) {
    await tx`
      insert into compute_transactions (season_id, team_id, pool, kind, amount_micro_usd)
      select ${a.seasonId}, null, 'editorial', 'grant', s.editorial_budget_micro_usd from seasons s
      where s.id = ${a.seasonId} and s.editorial_budget_micro_usd > 0
      on conflict do nothing`;
    return;
  }
  await tx`
    insert into compute_transactions (season_id, team_id, kind, amount_micro_usd)
    select ${a.seasonId}, ${a.teamId}, 'grant', s.budget_per_team_micro_usd from seasons s
    where s.id = ${a.seasonId} and s.budget_per_team_micro_usd > 0
    on conflict do nothing`;
}

async function balance(tx: Tx, a: Account): Promise<number> {
  const [r] = await tx<{ b: number }[]>`
    select coalesce(sum(amount_micro_usd), 0)::bigint as b from compute_transactions
    where season_id = ${a.seasonId}
      and ${a.teamId === null ? tx`pool = 'editorial'` : tx`team_id = ${a.teamId}`}`;
  return Number(r!.b);
}

/**
 * Releases a run's outstanding holds (reserved − released, per attempt). With `beforeAttempt`
 * only holds left by earlier attempts are released (a crashed attempt's reservation), so a
 * live attempt can hold several reservations (one per model call).
 */
async function releaseHolds(tx: Tx, a: Account, runId: string, beforeAttempt?: number) {
  const holds = await tx<{ attempt: number; held: number }[]>`
    select attempt,
      (coalesce(-sum(amount_micro_usd) filter (where kind = 'reserve'), 0)
       - coalesce(sum(amount_micro_usd) filter (where kind = 'release'), 0))::bigint as held
    from compute_transactions where agent_run_id = ${runId} and kind in ('reserve', 'release')
    group by attempt`;
  for (const h of holds) {
    if (Number(h.held) <= 0 || (beforeAttempt !== undefined && h.attempt >= beforeAttempt)) continue;
    await tx`insert into compute_transactions (season_id, team_id, pool, agent_run_id, kind, amount_micro_usd, attempt)
      values (${a.seasonId}, ${a.teamId}, ${poolOf(a)}, ${runId}, 'release', ${Number(h.held)}, ${h.attempt})`;
  }
}

const attemptOf = async (tx: Tx, runId: string) => {
  const [r] = await tx<{ attempt: number }[]>`select attempt from agent_runs where id = ${runId}`;
  return r?.attempt ?? 0;
};

interface Usage {
  runId: string;
  costMicroUsd: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Reserve / settle / release against one account, each under the account's advisory lock. */
function accountLedger(db: Db) {
  return {
    /** Holds the worst-case cost of one model call; false if the balance can't cover it. */
    reserve: (a: Account, runId: string, estimateMicroUsd: number) =>
      db.begin(async (tx) => {
        await lockAccount(tx, a);
        await ensureGrant(tx, a);
        const attempt = await attemptOf(tx, runId);
        // A retried run first returns holds left by a crashed earlier attempt.
        await releaseHolds(tx, a, runId, attempt);
        if ((await balance(tx, a)) < estimateMicroUsd) return false;
        await tx`insert into compute_transactions (season_id, team_id, pool, agent_run_id, kind, amount_micro_usd, attempt)
          values (${a.seasonId}, ${a.teamId}, ${poolOf(a)}, ${runId}, 'reserve', ${-estimateMicroUsd}, ${attempt})`;
        return true;
      }),
    settle: async (a: Account, u: Usage) => {
      await db.begin(async (tx) => {
        await lockAccount(tx, a);
        await releaseHolds(tx, a, u.runId);
        await tx`insert into compute_transactions
            (season_id, team_id, pool, agent_run_id, kind, amount_micro_usd, provider, model, input_tokens, output_tokens, attempt)
          values (${a.seasonId}, ${a.teamId}, ${poolOf(a)}, ${u.runId}, 'charge', ${-u.costMicroUsd}, ${u.provider}, ${u.model},
            ${u.inputTokens}, ${u.outputTokens}, ${await attemptOf(tx, u.runId)})
          on conflict do nothing`;
      });
    },
    release: async (a: Account, runId: string) => {
      await db.begin(async (tx) => {
        await lockAccount(tx, a);
        await releaseHolds(tx, a, runId);
      });
    },
  };
}

/** The ComputeGate used by managers: enforces each team's season budget. */
export function ledgerGate(db: Db): ComputeGate {
  const l = accountLedger(db);
  return {
    reserve: ({ seasonId, teamId, runId, estimateMicroUsd }) =>
      l.reserve({ seasonId, teamId }, runId, estimateMicroUsd),
    settle: ({ seasonId, teamId, ...usage }) => l.settle({ seasonId, teamId }, usage),
    release: ({ seasonId, teamId, runId }) => l.release({ seasonId, teamId }, runId),
  };
}

/** Meters the AI journalists against the season's editorial budget. */
export interface EditorialGate {
  reserve(a: { seasonId: string; runId: string; estimateMicroUsd: number }): Promise<boolean>;
  settle(a: { seasonId: string } & Usage): Promise<void>;
  release(a: { seasonId: string; runId: string }): Promise<void>;
}

export function editorialGate(db: Db): EditorialGate {
  const l = accountLedger(db);
  return {
    reserve: ({ seasonId, runId, estimateMicroUsd }) => l.reserve({ seasonId, teamId: null }, runId, estimateMicroUsd),
    settle: ({ seasonId, ...usage }) => l.settle({ seasonId, teamId: null }, usage),
    release: ({ seasonId, runId }) => l.release({ seasonId, teamId: null }, runId),
  };
}

export interface EditorialBudget {
  grantedMicroUsd: number;
  spentMicroUsd: number;
  reservedMicroUsd: number;
  remainingMicroUsd: number;
  runs: number;
}

/** The season's editorial budget position (before the first article, the full budget). */
export async function editorialBudgetSummary(db: Db, seasonId: string): Promise<EditorialBudget> {
  const [r] = await db<
    {
      budget: number;
      granted: number | null;
      spent: number | null;
      reserve: number | null;
      released: number | null;
      total: number | null;
      runs: number;
    }[]
  >`
    select s.editorial_budget_micro_usd as budget,
      sum(c.amount_micro_usd) filter (where c.kind = 'grant')::bigint as granted,
      (-sum(c.amount_micro_usd) filter (where c.kind = 'charge'))::bigint as spent,
      (-sum(c.amount_micro_usd) filter (where c.kind = 'reserve'))::bigint as reserve,
      sum(c.amount_micro_usd) filter (where c.kind = 'release')::bigint as released,
      sum(c.amount_micro_usd)::bigint as total,
      count(distinct c.agent_run_id) filter (where c.kind = 'charge')::int as runs
    from seasons s
    left join compute_transactions c on c.season_id = s.id and c.pool = 'editorial'
    where s.id = ${seasonId}
    group by s.editorial_budget_micro_usd`;
  if (!r) throw new Error(`no season ${seasonId}`);
  return {
    grantedMicroUsd: r.granted === null ? Number(r.budget) : Number(r.granted),
    spentMicroUsd: Number(r.spent ?? 0),
    reservedMicroUsd: Math.max(0, Number(r.reserve ?? 0) - Number(r.released ?? 0)),
    remainingMicroUsd: r.granted === null ? Number(r.budget) : Number(r.total ?? 0),
    runs: r.runs,
  };
}

export interface BudgetSummary {
  teamId: string;
  grantedMicroUsd: number;
  spentMicroUsd: number;
  reservedMicroUsd: number;
  remainingMicroUsd: number;
  runs: number;
  exhausted: boolean;
}

/**
 * Per-team budget position for a season. `exhausted` means the remaining balance can no
 * longer cover a worst-case manager decision (`minCallMicroUsd`), so managers keep their last tactics.
 */
export async function budgetSummary(
  db: Db,
  seasonId: string,
  minCallMicroUsd = worstCaseDecisionMicroUsd("claude-opus-5-5"),
): Promise<BudgetSummary[]> {
  const rows = await db<
    {
      team_id: string;
      budget: number;
      granted: number | null;
      spent: number | null;
      reserve: number | null;
      released: number | null;
      total: number | null;
      runs: number;
    }[]
  >`
    select st.team_id, s.budget_per_team_micro_usd as budget,
      sum(c.amount_micro_usd) filter (where c.kind = 'grant')::bigint as granted,
      (-sum(c.amount_micro_usd) filter (where c.kind = 'charge'))::bigint as spent,
      (-sum(c.amount_micro_usd) filter (where c.kind = 'reserve'))::bigint as reserve,
      sum(c.amount_micro_usd) filter (where c.kind = 'release')::bigint as released,
      sum(c.amount_micro_usd)::bigint as total,
      count(distinct c.agent_run_id) filter (where c.kind = 'charge')::int as runs
    from season_teams st join seasons s on s.id = st.season_id
    left join compute_transactions c on c.season_id = st.season_id and c.team_id = st.team_id
    where st.season_id = ${seasonId}
    group by st.team_id, s.budget_per_team_micro_usd
    order by st.team_id`;
  return rows.map((r) => {
    // Before the first reservation no grant row exists yet; the budget is still available.
    const granted = r.granted === null ? Number(r.budget) : Number(r.granted);
    const remaining = r.granted === null ? Number(r.budget) : Number(r.total ?? 0);
    return {
      teamId: r.team_id,
      grantedMicroUsd: granted,
      spentMicroUsd: Number(r.spent ?? 0),
      reservedMicroUsd: Math.max(0, Number(r.reserve ?? 0) - Number(r.released ?? 0)),
      remainingMicroUsd: remaining,
      runs: r.runs,
      exhausted: remaining < minCallMicroUsd,
    };
  });
}
