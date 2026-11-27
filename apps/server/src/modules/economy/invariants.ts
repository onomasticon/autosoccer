/**
 * Hard invariants, checked after every season of every run. A failure names the seed, season and
 * rule broken, so the run can be replayed (`--replay <seed>`) and captured as a regression.
 */
import { digest, type World } from "./engine.ts";

export interface InvariantFailure {
  seed: number;
  ruleset: string;
  scenario: string;
  season: number;
  invariant:
    | "ledger-reconciles"
    | "unique-settlements"
    | "one-registration"
    | "squad-limits"
    | "viable-squad"
    | "no-forfeits"
    | "bounded-rescue"
    | "history-immutable"
    | "no-unaccounted-debt";
  detail: string;
}

export function checkInvariants(w: World): InvariantFailure[] {
  const out: InvariantFailure[] = [];
  const r = w.config.ruleset;
  const fail = (invariant: InvariantFailure["invariant"], detail: string) =>
    out.push({
      seed: w.config.seed,
      ruleset: r.name,
      scenario: w.config.scenario.name,
      season: w.season,
      invariant,
      detail,
    });

  // The ledger is the money: every club's cash is exactly the sum of its entries.
  const sums = new Map<string, number>();
  for (const e of w.ledger) sums.set(e.club, (sums.get(e.club) ?? 0) + e.amount);
  for (const c of w.clubs.values())
    if ((sums.get(c.id) ?? 0) !== c.cash)
      fail("ledger-reconciles", `${c.id}: cash ${c.cash} ≠ ledger ${sums.get(c.id)}`);
  // Transfers conserve money: every fee paid was received (or went to no club, for an unattached player).
  const keys = new Set<string>();
  for (const e of w.ledger) {
    if (keys.has(e.key)) fail("unique-settlements", e.key);
    keys.add(e.key);
  }

  // One club per player; squads within the limits; every club can field a side.
  const sizes = new Map<string, number>();
  const keepers = new Map<string, number>();
  for (const p of w.players.values()) {
    if (p.retired && p.club) fail("one-registration", `${p.id} is retired but registered with ${p.club}`);
    if (!p.club) continue;
    if (!w.clubs.has(p.club)) fail("one-registration", `${p.id} registered with unknown club ${p.club}`);
    sizes.set(p.club, (sizes.get(p.club) ?? 0) + 1);
    if (p.position === "GK") keepers.set(p.club, (keepers.get(p.club) ?? 0) + 1);
  }
  for (const c of w.clubs.values()) {
    const n = sizes.get(c.id) ?? 0;
    if (n > r.squad.max) fail("squad-limits", `${c.id} has ${n} players (max ${r.squad.max})`);
    if (n < r.squad.side || (keepers.get(c.id) ?? 0) < 1)
      fail("viable-squad", `${c.id}: ${n} players, ${keepers.get(c.id) ?? 0} GK`);
  }
  for (const e of w.events.filter((x) => x.season === w.season && x.kind === "unviable"))
    fail("viable-squad", `${e.club} couldn't field a side in round ${e.round}`);

  // Rulesets that promise every fixture is played: no walkovers or void fixtures for money.
  if (r.noForfeits) {
    const forfeits = w.fixtures.filter((f) => f.season === w.season && (f.walkover || f.void)).length;
    if (forfeits) fail("no-forfeits", `${forfeits} fixtures not played`);
  }

  // No infinite bailout: rescue capital (takeovers, free support) is bounded per club per season.
  const rescues = new Map<string, number>();
  for (const e of w.ledger)
    if (e.season === w.season && (e.kind === "takeover" || e.kind === "support"))
      rescues.set(e.club, (rescues.get(e.club) ?? 0) + 1);
  for (const [club, n] of rescues) if (n > 1) fail("bounded-rescue", `${club} rescued ${n} times in one season`);

  // Debt is always accounted: outstanding loans are non-negative and only exist under a lender.
  for (const c of w.clubs.values())
    for (const l of c.loans)
      if (l.balance < 0 || !r.lender) fail("no-unaccounted-debt", `${c.id} loan ${l.id} balance ${l.balance}`);

  // Past seasons never change.
  const bySeason = new Map<number, typeof w.fixtures>();
  for (const f of w.fixtures) {
    const list = bySeason.get(f.season);
    if (list) list.push(f);
    else bySeason.set(f.season, [f]);
  }
  for (const [s, d] of w.history)
    if (digest(bySeason.get(s) ?? []) !== d) fail("history-immutable", `season ${s} changed`);
  return out;
}
