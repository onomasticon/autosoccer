/**
 * Compute ledger: a per-team, per-season USD-equivalent budget kept as an append-only
 * list of integer micro-USD transactions. Balance = Σ amount.
 *   grant   +budget          once per (season, team), created lazily
 *   reserve −estimate        before a model call (worst case)
 *   release +unused hold     when the call finishes or fails
 *   charge  −actual cost     what the call really cost (tokens × price)
 * All mutations for a team run under a Postgres advisory lock, so concurrent agent runs
 * can't overspend: a reservation succeeds only if the balance covers it.
 */
import type { Db } from "@autosoccer/db";
import type postgres from "postgres";
import { type ComputeGate, worstCaseDecisionMicroUsd } from "../agents/service.ts";

type Tx = postgres.TransactionSql;

const lockTeam = (tx: Tx, seasonId: string, teamId: string) =>
  tx`select pg_advisory_xact_lock(hashtext(${`ledger:${seasonId}:${teamId}`}))`;

async function ensureGrant(tx: Tx, seasonId: string, teamId: string) {
  await tx`
    insert into compute_transactions (season_id, team_id, kind, amount_micro_usd)
    select ${seasonId}, ${teamId}, 'grant', s.budget_per_team_micro_usd from seasons s
    where s.id = ${seasonId} and s.budget_per_team_micro_usd > 0
    on conflict do nothing`;
}

async function balance(tx: Tx, seasonId: string, teamId: string): Promise<number> {
  const [r] = await tx<{ b: number }[]>`
    select coalesce(sum(amount_micro_usd), 0)::bigint as b from compute_transactions
    where season_id = ${seasonId} and team_id = ${teamId}`;
  return Number(r!.b);
}

/**
 * Releases a run's outstanding holds (reserved − released, per attempt). With `beforeAttempt`
 * only holds left by earlier attempts are released (a crashed attempt's reservation), so a
 * live attempt can hold several reservations (one per model call).
 */
async function releaseHolds(tx: Tx, seasonId: string, teamId: string, runId: string, beforeAttempt?: number) {
  const holds = await tx<{ attempt: number; held: number }[]>`
    select attempt,
      (coalesce(-sum(amount_micro_usd) filter (where kind = 'reserve'), 0)
       - coalesce(sum(amount_micro_usd) filter (where kind = 'release'), 0))::bigint as held
    from compute_transactions where agent_run_id = ${runId} and kind in ('reserve', 'release')
    group by attempt`;
  for (const h of holds) {
    if (Number(h.held) <= 0 || (beforeAttempt !== undefined && h.attempt >= beforeAttempt)) continue;
    await tx`insert into compute_transactions (season_id, team_id, agent_run_id, kind, amount_micro_usd, attempt)
      values (${seasonId}, ${teamId}, ${runId}, 'release', ${Number(h.held)}, ${h.attempt})`;
  }
}

const attemptOf = async (tx: Tx, runId: string) => {
  const [r] = await tx<{ attempt: number }[]>`select attempt from agent_runs where id = ${runId}`;
  return r?.attempt ?? 0;
};

/** The ComputeGate used by managers (and editorial agents): enforces each team's season budget. */
export function ledgerGate(db: Db): ComputeGate {
  return {
    /** Holds the worst-case cost of one model call; false if the balance can't cover it. */
    async reserve({ seasonId, teamId, runId, estimateMicroUsd }) {
      return db.begin(async (tx) => {
        await lockTeam(tx, seasonId, teamId);
        await ensureGrant(tx, seasonId, teamId);
        const attempt = await attemptOf(tx, runId);
        // A retried run first returns holds left by a crashed earlier attempt.
        await releaseHolds(tx, seasonId, teamId, runId, attempt);
        if ((await balance(tx, seasonId, teamId)) < estimateMicroUsd) return false;
        await tx`insert into compute_transactions (season_id, team_id, agent_run_id, kind, amount_micro_usd, attempt)
          values (${seasonId}, ${teamId}, ${runId}, 'reserve', ${-estimateMicroUsd}, ${attempt})`;
        return true;
      });
    },
    async settle({ seasonId, teamId, runId, costMicroUsd, provider, model, inputTokens, outputTokens }) {
      await db.begin(async (tx) => {
        await lockTeam(tx, seasonId, teamId);
        await releaseHolds(tx, seasonId, teamId, runId);
        await tx`insert into compute_transactions
            (season_id, team_id, agent_run_id, kind, amount_micro_usd, provider, model, input_tokens, output_tokens, attempt)
          values (${seasonId}, ${teamId}, ${runId}, 'charge', ${-costMicroUsd}, ${provider}, ${model}, ${inputTokens}, ${outputTokens},
            ${await attemptOf(tx, runId)})
          on conflict do nothing`;
      });
    },
    async release({ seasonId, teamId, runId }) {
      await db.begin(async (tx) => {
        await lockTeam(tx, seasonId, teamId);
        await releaseHolds(tx, seasonId, teamId, runId);
      });
    },
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
