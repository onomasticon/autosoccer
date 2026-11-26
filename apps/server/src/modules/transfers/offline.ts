/**
 * Rule-based transfer decisions for the offline provider (tests, CI, keyless demos, the balance
 * exercise). It reads exactly the facts the real prompt contains. It is a stand-in, not a model:
 *  - listing: invite offers for unused players in surplus positions (more when headroom is thin);
 *  - bidding: one bid for the best affordable upgrade on the weakest starting place;
 *  - replying: keep key players (top two by ability, or last season's regular scorer) unless
 *    offered twice the guide fee, and regular starters unless offered 1.5×; sell listed players at
 *    a fair fee; sell the rest at or above the guide fee.
 */
import { createHash } from "node:crypto";
import type { BidDecision, ListingDecision, ReplyDecision, TransferFacts, TransferPlayerFact } from "./prompts.ts";

const SLOTS: Record<number, string[]> = {
  5: ["GK", "DF", "DF", "MF", "FW"],
  7: ["GK", "DF", "DF", "MF", "MF", "MF", "FW"],
  11: ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "MF", "FW", "FW"],
};
/** Keep this much headroom after a signing (two rounds of a typical wage bill). */
const BUFFER = 3_000_000;
const cr = (n: number) => `${n.toLocaleString("en-GB")} cr`;
const round50k = (n: number) => Math.round(n / 50_000) * 50_000;

/** 0, 1 or 2: how hard this manager pushes in the market (stable per manager). */
function appetite(f: TransferFacts): number {
  return createHash("sha256").update(`appetite:${f.manager.name}`).digest()[0]! % 3;
}

const slotsFor = (f: TransferFacts, pos: string) =>
  (SLOTS[f.format.playersPerTeam] ?? SLOTS[7]!).filter((p) => p === pos).length;

function strongest(f: TransferFacts) {
  const used = new Set<string>();
  return (SLOTS[f.format.playersPerTeam] ?? SLOTS[7]!).map((pos) => {
    const p = f.squad
      .filter((x) => x.position === pos && !used.has(x.ref))
      .sort((a, b) => b.overall - a.overall || a.shirt - b.shirt)[0];
    if (p) used.add(p.ref);
    return { pos, p: p ?? null };
  });
}

export function offlineListing(f: TransferFacts): ListingDecision {
  const thin = f.finances.headroom < BUFFER;
  const surplus = (p: TransferPlayerFact) =>
    p.position !== "GK" && f.squad.filter((x) => x.position === p.position).length > slotsFor(f, p.position) + 1;
  const unused = f.squad
    .filter((p) => p.lastSeason && p.lastSeason.teamMatches > 0 && p.lastSeason.starts === 0 && surplus(p))
    .sort((a, b) => b.wage - a.wage || a.shirt - b.shirt);
  const picks = unused.slice(0, Math.min(f.rules.maxListings, thin ? 2 : 1));
  if (!picks.length)
    return { listings: [], rationale: "Nobody to move on: every surplus player played a part last season." };
  return {
    listings: picks.map((p) => ({
      shirt: p.shirt,
      askingFee: p.guide,
      reason: `${p.name} made no starts last season and costs ${cr(p.wage)} a round; we have cover at ${p.position}.`,
    })),
    rationale: thin
      ? `Headroom is only ${cr(f.finances.headroom)}, so we're inviting offers to cut the wage bill.`
      : "Inviting offers for an unused squad player to free wages for a signing.",
  };
}

export function offlineBidding(f: TransferFacts): BidDecision {
  const spendable = Math.min(f.finances.cash, f.finances.headroom - BUFFER);
  if (f.squad.length >= f.rules.maxSquad || spendable < f.rules.minFee)
    return {
      bids: [],
      rationale:
        f.squad.length >= f.rules.maxSquad
          ? "The squad is full."
          : `Headroom of ${cr(f.finances.headroom)} leaves nothing to spend safely.`,
    };
  const side = strongest(f).filter((s) => s.p) as Array<{ pos: string; p: TransferPlayerFact }>;
  const weakest = [...side].sort((a, b) => a.p.overall - b.p.overall)[0];
  if (!weakest) return { bids: [], rationale: "No starting place to improve." };
  const push = appetite(f);
  const offers = (f.market ?? [])
    .filter((m) => m.position === weakest.pos && m.overall >= weakest.p.overall + 3)
    .map((m) => ({
      m,
      fee: round50k(m.listed ? (m.listed.askingFee ?? m.guide) * 0.9 : m.guide * (1 + 0.1 * push)),
    }))
    .filter((o) => o.fee >= f.rules.minFee && o.fee <= spendable)
    .sort((a, b) => b.m.overall - a.m.overall || a.fee - b.fee || a.m.ref.localeCompare(b.m.ref));
  const pick = offers[0];
  if (!pick)
    return {
      bids: [],
      rationale: `Our weakest starting place is ${weakest.pos} (${weakest.p.name}, ${weakest.p.overall}), but no affordable upgrade is available.`,
    };
  return {
    bids: [
      {
        player: pick.m.ref,
        fee: pick.fee,
        reason: `${pick.m.name} (${pick.m.overall}) would replace ${weakest.p.name} (${weakest.p.overall}) at ${weakest.pos}; the fee leaves ${cr(f.finances.headroom - pick.fee - pick.m.wage * f.finances.rounds)} headroom after wages.`,
      },
    ],
    rationale: `Strengthening our weakest starting place, ${weakest.pos}.`,
  };
}

export function offlineReplying(f: TransferFacts): ReplyDecision {
  const offers = f.offers ?? [];
  const top2 = new Set(
    [...f.squad]
      .sort((a, b) => b.overall - a.overall || a.shirt - b.shirt)
      .slice(0, 2)
      .map((p) => p.ref),
  );
  const decisions: ReplyDecision["decisions"] = [];
  const byPlayer = new Map<string, typeof offers>();
  for (const o of offers) byPlayer.set(o.ref, [...(byPlayer.get(o.ref) ?? []), o]);
  let sold = 0;
  for (const [ref, list] of byPlayer) {
    const p = f.squad.find((x) => x.ref === ref);
    const sorted = [...list].sort((a, b) => b.fee - a.fee || a.label.localeCompare(b.label));
    const best = sorted[0]!;
    let accept = false;
    let why: string;
    const scorer = !!p?.lastSeason && p.lastSeason.goals >= 3 && p.lastSeason.starts * 2 >= p.lastSeason.teamMatches;
    const regular =
      !!p?.lastSeason && p.lastSeason.teamMatches > 0 && p.lastSeason.starts * 2 >= p.lastSeason.teamMatches;
    const samePos = p ? f.squad.filter((x) => x.position === p.position).length : 0;
    const coverOk = p ? samePos - 1 >= slotsFor(f, p.position) && f.squad.length - sold - 1 >= f.rules.minSquad : false;
    if (!p) why = "Not our player.";
    else if (!coverOk) why = `Selling ${p.name} would leave us short at ${p.position}.`;
    else if (p.listed) {
      accept = best.fee >= 0.8 * (p.listed.askingFee ?? p.guide);
      why = accept
        ? `${p.name} was listed and ${cr(best.fee)} is a fair fee.`
        : `${cr(best.fee)} is too far below our asking price for ${p.name}.`;
    } else if (top2.has(ref) || scorer) {
      accept = best.fee >= 2 * p.guide;
      why = accept
        ? `${cr(best.fee)} is more than twice ${p.name}'s guide fee; too much to refuse.`
        : `${p.name} is central to us (overall ${p.overall}${p.lastSeason ? `, ${p.lastSeason.starts}/${p.lastSeason.teamMatches} starts and ${p.lastSeason.goals} goals last season` : ""}); not for sale.`;
    } else if (regular) {
      accept = best.fee >= 1.5 * p.guide;
      why = accept
        ? `${cr(best.fee)} is well above ${p.name}'s guide fee of ${cr(p.guide)}; we can replace a starter for that.`
        : `${p.name} started ${p.lastSeason!.starts} of ${p.lastSeason!.teamMatches} last season; ${cr(best.fee)} isn't enough to lose a regular starter.`;
    } else {
      accept = best.fee >= p.guide;
      why = accept
        ? `${cr(best.fee)} meets ${p.name}'s guide fee and we have cover at ${p.position}.`
        : `${cr(best.fee)} is below ${p.name}'s guide fee of ${cr(p.guide)}.`;
    }
    if (accept) sold++;
    decisions.push({ offer: best.label, decision: accept ? "accept" : "reject", reason: why });
    for (const o of sorted.slice(1))
      decisions.push({
        offer: o.label,
        decision: "reject",
        reason: accept ? `We accepted a higher offer for ${p?.name ?? ref}.` : why,
      });
  }
  return {
    decisions,
    rationale: offers.length ? `${sold} sale${sold === 1 ? "" : "s"} agreed.` : "No offers received.",
  };
}
