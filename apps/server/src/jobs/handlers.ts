/** All background job handlers, wired together (used by the worker process and CLIs). */
import type { Db } from "@autosoccer/db";
import type { ReplayStore } from "@autosoccer/sim-adapter";
import type { Logger } from "../log.ts";
import type { LlmClient } from "../modules/agents/llm.ts";
import { type ComputeGate, enqueueManagerJobs, managerJobHandlers } from "../modules/agents/service.ts";
import { editorialJobHandlers, enqueueEditorial } from "../modules/editorial/service.ts";
import { ledgerGate } from "../modules/ledger/service.ts";
import { MATCH_JOB, matchJobHandler } from "../modules/matches/service.ts";
import type { JobHandler } from "./worker.ts";

export interface PlatformDeps {
  db: Db;
  store: ReplayStore;
  /** Model client for the AI managers. */
  llm: LlmClient;
  /** Model client for the AI journalists; without it no articles are written. */
  editorialLlm?: LlmClient;
  gate?: ComputeGate;
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
        await enqueueManagerJobs(d.db, "post", fixtureId);
        if (d.editorialLlm) await enqueueEditorial(d.db, fixtureId);
      },
    }),
    // Every manager call is metered against the team's season budget unless a gate is injected.
    ...managerJobHandlers({ db: d.db, llm: d.llm, gate: d.gate ?? ledgerGate(d.db), log: d.log }),
    ...(d.editorialLlm ? editorialJobHandlers({ db: d.db, llm: d.editorialLlm, log: d.log }) : {}),
  };
}
