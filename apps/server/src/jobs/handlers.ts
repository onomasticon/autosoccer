/** All background job handlers, wired together (used by the worker process and CLIs). */
import type { Db } from "@autosoccer/db";
import type { ReplayStore } from "@autosoccer/sim-adapter";
import type { Logger } from "../log.ts";
import type { LlmClient } from "../modules/agents/llm.ts";
import { type ComputeGate, enqueueManagerJobs, managerJobHandlers } from "../modules/agents/service.ts";
import { contractJobHandlers } from "../modules/contracts/scheduler.ts";
import { offlineEditorialLlm } from "../modules/editorial/offline.ts";
import { editorialJobHandlers, enqueueEditorial } from "../modules/editorial/service.ts";
import { settleFinances } from "../modules/finance/settle.ts";
import { settleInjuries } from "../modules/injuries/injuries.ts";
import { type EditorialGate, editorialGate, ledgerGate } from "../modules/ledger/service.ts";
import { MATCH_JOB, matchJobHandler } from "../modules/matches/service.ts";
import { transferJobHandlers } from "../modules/transfers/window.ts";
import type { JobHandler } from "./worker.ts";

export interface PlatformDeps {
  db: Db;
  store: ReplayStore;
  /** Model client for the AI managers. */
  llm: LlmClient;
  /** Model client for the AI journalists; without it no articles are written. */
  editorialLlm?: LlmClient;
  gate?: ComputeGate;
  /** Meters the journalists against the season's editorial budget (default: the ledger). */
  editorialGate?: EditorialGate;
  log?: Logger;
  halfDurationSec?: number;
}

export function buildHandlers(d: PlatformDeps): Record<string, JobHandler> {
  return {
    [MATCH_JOB]: matchJobHandler({
      db: d.db,
      store: d.store,
      halfDurationSec: d.halfDurationSec,
      // After every official result (asynchronously, never during the simulation):
      // managers review it, and the newsroom writes about it.
      onCompleted: async (fixtureId) => {
        // Result income (idempotent; the scheduler's reconciler would also catch it next tick).
        const [f] = await d.db<{ season_id: string }[]>`select season_id from fixtures where id = ${fixtureId}`;
        if (f) await settleFinances(d.db, f.season_id);
        // Injuries from the match (injury/1; idempotent; the scheduler also catches up before each round).
        if (f) await settleInjuries(d.db, f.season_id);
        await enqueueManagerJobs(d.db, "post", fixtureId);
        if (d.editorialLlm) await enqueueEditorial(d.db, fixtureId);
      },
    }),
    // Every manager call is metered against the team's season budget unless a gate is injected.
    ...managerJobHandlers({ db: d.db, llm: d.llm, gate: d.gate ?? ledgerGate(d.db), log: d.log }),
    // Transfer-window decisions (listing, bidding, replying), metered the same way.
    ...transferJobHandlers({ db: d.db, llm: d.llm, gate: d.gate ?? ledgerGate(d.db), log: d.log }),
    // transfer/2 contract decisions (renewals, free-agent offers), metered the same way.
    ...contractJobHandlers({ db: d.db, llm: d.llm, gate: d.gate ?? ledgerGate(d.db), log: d.log }),
    // Journalist calls are metered against the season's editorial budget; once it can't cover a
    // call, the offline template writer (same facts, no model, no cost) writes the piece instead.
    ...(d.editorialLlm
      ? editorialJobHandlers({
          db: d.db,
          llm: d.editorialLlm,
          log: d.log,
          gate: d.editorialGate ?? editorialGate(d.db),
          fallback: offlineEditorialLlm(d.editorialLlm.model.replace(/^offline:/, "")),
        })
      : {}),
  };
}
