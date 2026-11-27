/**
 * Deterministic stand-ins for the AI managers in the economy harness. They aren't meant to be good,
 * only to cover the strategies the economy must survive:
 *
 *  - conservative: one upgrade a window at up to the guide fee, keeping a season's wages in hand;
 *    sells only surplus players at the guide fee or better.
 *  - aggressive: two upgrades at up to 1.3× guide, spending down to a few rounds of wages.
 *  - trader: buys young players (≤ 23) at or under the guide, sells anyone 28+ for 1.2× guide.
 *  - adaptive: aggressive when rich (two seasons of wages), conservative when not.
 *  - opportunist: low bids (0.7× guide) for the best players at clubs short of money; sells high.
 */
import type { FinanceRules } from "../finance/rules.ts";
import { squadOf, startingSide, type World } from "./engine.ts";
import type { HClub, HPlayer, PolicyName } from "./model.ts";

interface MarketContext {
  minFee: number;
  maxBids: number;
  fr: FinanceRules;
}

const wageBill = (w: World, club: string) => squadOf(w, club).reduce((s, p) => s + p.wage, 0);

function effective(w: World, c: HClub): Exclude<PolicyName, "adaptive"> {
  if (c.policy !== "adaptive") return c.policy;
  const rounds = 2 * (w.clubs.size - 1);
  return c.cash > 2 * rounds * wageBill(w, c.id) ? "aggressive" : "conservative";
}

/** The club's bids this window: player id and fee, best first. */
export function decideBids(w: World, c: HClub, m: MarketContext): Array<{ player: string; fee: number }> {
  const policy = effective(w, c);
  const r = w.config.ruleset;
  const rounds = 2 * (w.clubs.size - 1);
  const squad = squadOf(w, c.id);
  const side = startingSide(squad, r.squad.side);
  if (!side) return [];
  const bill = wageBill(w, c.id);
  const reserve = policy === "aggressive" ? 3 * bill : policy === "opportunist" ? rounds * bill * 0.5 : rounds * bill;
  let budget = c.cash - reserve;
  if (budget < m.minFee || squad.length >= r.squad.max) return [];
  const weakest = [...side].sort((a, b) => a.overall - b.overall);
  const multiple = policy === "aggressive" ? 1.3 : policy === "opportunist" ? 0.7 : 1;
  const want = policy === "aggressive" ? 2 : 1;
  const out: Array<{ player: string; fee: number }> = [];
  const taken = new Set<string>();
  const bills = new Map<string, number>();
  const distressed = (club: string | null) => {
    if (!club) return false;
    const o = w.clubs.get(club)!;
    if (!bills.has(club)) bills.set(club, wageBill(w, club));
    return o.cash < 4 * bills.get(club)! || o.administration;
  };
  for (const target of weakest) {
    if (out.length >= Math.min(want, m.maxBids)) break;
    const candidates = [...w.players.values()].filter(
      (p) =>
        p.club !== c.id &&
        !taken.has(p.id) &&
        p.position === target.position &&
        p.overall > target.overall + 1 &&
        (policy !== "trader" || p.age <= 23) &&
        (policy !== "opportunist" || distressed(p.club)),
    );
    candidates.sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
    for (const p of candidates) {
      const fee = Math.max(
        m.minFee,
        Math.round((r.guideFee(p.overall, p.goalsLastSeason) * multiple) / 50_000) * 50_000,
      );
      if (fee > budget) continue;
      out.push({ player: p.id, fee });
      taken.add(p.id);
      budget -= fee;
      break;
    }
  }
  return out;
}

/** Whether the seller takes an offer: core players are kept unless the fee is well above the guide. */
export function decideReply(w: World, seller: HClub, p: HPlayer, fee: number): boolean {
  const policy = effective(w, seller);
  const r = w.config.ruleset;
  const guide = r.guideFee(p.overall, p.goalsLastSeason);
  const squad = squadOf(w, seller.id);
  const side = startingSide(squad, r.squad.side) ?? [];
  const best = [...squad].sort((a, b) => b.overall - a.overall).slice(0, 2);
  // A club short of money sells (the market's way out of trouble under any ruleset).
  const rounds = 2 * (w.clubs.size - 1);
  const short = seller.cash < (rounds / 3) * wageBill(w, seller.id);
  if (short) return fee >= 0.8 * guide;
  if (best.includes(p)) return fee >= 2 * guide;
  const starter = side.includes(p);
  switch (policy) {
    case "trader":
      return p.age >= 28 ? fee >= 1.2 * guide : fee >= (starter ? 1.5 : 1) * guide;
    case "opportunist":
      return fee >= (starter ? 1.8 : 1.3) * guide;
    case "aggressive":
      return fee >= (starter ? 1.6 : 1.1) * guide;
    default:
      return fee >= (starter ? 1.5 : 1) * guide;
  }
}
