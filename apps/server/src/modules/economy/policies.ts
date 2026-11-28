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
        p.club !== null && // free agents sign for wages in the free-agent round, never for a fee
        p.club !== c.id &&
        !taken.has(p.id) &&
        p.position === target.position &&
        p.overall > target.overall + 1 &&
        (policy !== "trader" || p.age <= 23) &&
        (policy !== "opportunist" || distressed(p.club)),
    );
    // Listed players first: their asking fee buys them outright (transfer/2 binding listings).
    const listed = (p: HPlayer) => (w.listings.has(p.id) ? 0 : 1);
    candidates.sort((a, b) => listed(a) - listed(b) || b.overall - a.overall || a.id.localeCompare(b.id));
    for (const p of candidates) {
      const guide = r.guideFee(p.overall, p.goalsLastSeason);
      const ask = w.listings.get(p.id);
      // Pay a listed player's asking fee when it's within what this club would pay (with a little slack).
      const fee =
        ask !== undefined && ask <= guide * Math.max(multiple, 1) * 1.1
          ? ask
          : Math.max(m.minFee, Math.round((guide * multiple) / 50_000) * 50_000);
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

/**
 * transfer/2 listings: a club lists its surplus (beyond its target squad), weakest value first, at the
 * listing's asking fee; a trader also lists a regular aged 29+ to cash in before he declines. Keepers
 * are only listed when the club has more than two.
 */
export function decideListings(w: World, c: HClub): Array<{ player: string; ask: number }> {
  const r = w.config.ruleset;
  const mk = r.market;
  if (!mk) return [];
  const squad = squadOf(w, c.id);
  const keepers = squad.filter((p) => p.position === "GK").length;
  const side = new Set((startingSide(squad, r.squad.side) ?? []).map((p) => p.id));
  const pool = squad
    .filter((p) => (p.position !== "GK" || keepers > 2) && !side.has(p.id))
    .sort((a, b) => a.overall - b.overall || b.wage - a.wage || a.id.localeCompare(b.id));
  const out: HPlayer[] = pool.slice(0, Math.max(0, squad.length - r.squad.target));
  if (effective(w, c) === "trader") {
    const veteran = squad.find((p) => p.age >= 29 && side.has(p.id) && !out.includes(p));
    if (veteran) out.push(veteran);
  }
  return out.map((p) => ({
    player: p.id,
    ask: Math.max(r.minFee, Math.round((r.guideFee(p.overall, p.goalsLastSeason) * mk.listingAsk) / 50_000) * 50_000),
  }));
}

/**
 * transfer/2 renewal at contract expiry: keep the club's best players by rating, young ones worth
 * developing, and enough players to stay viable (a keeper included); release the rest.
 */
export function decideRenewal(w: World, c: HClub, p: HPlayer): boolean {
  const r = w.config.ruleset;
  const mk = r.market!;
  const squad = squadOf(w, c.id);
  if (squad.length <= r.squad.min) return true;
  if (p.position === "GK" && squad.filter((x) => x.position === "GK").length <= 2) return true;
  const rank = [...squad].sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id)).indexOf(p);
  if (rank < mk.renewal.keepBest) return true;
  const median = [...squad].map((x) => x.overall).sort((a, b) => a - b)[Math.floor(squad.length / 2)]!;
  return p.age <= mk.renewal.keepYoungUpTo && p.overall >= median - 3;
}

/**
 * A club's wage offer to a free agent, as a multiple of the rating-based wage, or null if it doesn't
 * want him: it must have room, need the player (short of its target, or he'd start), and afford a
 * season of his wages on top of its reserve. Aggressive clubs and rich adaptive ones pay a premium.
 */
export function freeAgentOffer(w: World, c: HClub, p: HPlayer, fr: FinanceRules): number | null {
  const r = w.config.ruleset;
  const squad = squadOf(w, c.id);
  if (squad.length >= r.squad.max) return null;
  const side = startingSide(squad, r.squad.side) ?? [];
  const weakest = side.filter((x) => x.position === p.position).sort((a, b) => a.overall - b.overall)[0];
  const needed = squad.length < r.squad.target || (weakest !== undefined && p.overall > weakest.overall + 1);
  if (!needed) return null;
  const rounds = 2 * (w.clubs.size - 1);
  const policy = effective(w, c);
  const reserve = policy === "aggressive" ? 3 * wageBill(w, c.id) : rounds * wageBill(w, c.id) * 0.5;
  if (c.cash - reserve < r.wage(p.overall, fr) * rounds) return null;
  return policy === "aggressive" ? 1.15 : policy === "opportunist" ? 0.95 : 1;
}
