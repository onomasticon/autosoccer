/**
 * What a manager is told, and may answer, in each phase of the transfer window (transfer/1).
 * Facts are built from records only (market.ts); answers are validated before anything is stored.
 */
import type { TeamSize } from "@autosoccer/contracts";
import { z } from "zod";

export type TransferPhase = "listing" | "bidding" | "replying";

export interface TransferPlayerFact {
  ref: string;
  shirt: number;
  name: string;
  club: string;
  position: string;
  overall: number;
  wage: number;
  guide: number;
  lastSeason: { starts: number; goals: number; teamMatches: number } | null;
  listed?: { askingFee: number | null; reason: string } | null;
}

export interface TransferFacts {
  phase: TransferPhase;
  manager: { name: string; persona: string; philosophy: string; memory: { summary: string; notes: string[] } };
  team: { name: string };
  format: { playersPerTeam: TeamSize };
  window: { season: string; deadline: string };
  rules: {
    maxListings: number;
    maxBids: number;
    minFee: number;
    minSquad: number;
    maxSquad: number;
    goalkeepers: number;
  };
  finances: {
    cash: number;
    distributionDue: number;
    wagesPerRound: number;
    rounds: number;
    seasonWages: number;
    headroom: number;
  };
  lastSeason: { name: string; position: number; points: number } | null;
  squad: TransferPlayerFact[];
  needs: string[];
  /** Bidding: other clubs' players. */
  market?: TransferPlayerFact[];
  /** Replying: offers received, grouped by player. */
  offers?: Array<{ label: string; ref: string; player: string; buyer: string; fee: number; buyerReason: string }>;
}

export const ListingDecision = z
  .object({
    listings: z
      .array(
        z
          .object({
            shirt: z.number().int().describe("shirt number of a player in your squad you invite offers for"),
            askingFee: z.number().int().nullable().describe("asking fee in credits, or null for offers"),
            reason: z.string().describe("one sentence, citing the facts"),
          })
          .strict(),
      )
      .describe("players to list (may be empty)"),
    rationale: z.string().describe("one or two sentences on your plan for this window"),
  })
  .strict();
export type ListingDecision = z.infer<typeof ListingDecision>;

export const BidDecision = z
  .object({
    bids: z
      .array(
        z
          .object({
            player: z.string().describe('the player\'s market reference, e.g. "HBC-10"'),
            fee: z.number().int().describe("fee offered, in credits"),
            reason: z.string().describe("one sentence, citing the facts"),
          })
          .strict(),
      )
      .describe("bids (may be empty)"),
    rationale: z.string().describe("one or two sentences"),
  })
  .strict();
export type BidDecision = z.infer<typeof BidDecision>;

export const ReplyDecision = z
  .object({
    decisions: z
      .array(
        z
          .object({
            offer: z.string().describe('the offer label, e.g. "B1"'),
            decision: z.enum(["accept", "reject"]),
            reason: z.string().describe("one sentence, citing the facts (sporting reasons are fine)"),
          })
          .strict(),
      )
      .describe("one decision per offer; unanswered offers are rejected"),
    rationale: z.string().describe("one or two sentences"),
  })
  .strict();
export type ReplyDecision = z.infer<typeof ReplyDecision>;

export const TRANSFER_TASKS = {
  listing: "transfer.listing",
  bidding: "transfer.bidding",
  replying: "transfer.replying",
} as const;

const cr = (n: number) => `${n.toLocaleString("en-GB")} cr`;

function playerLine(p: TransferPlayerFact, withClub: boolean): string {
  const rec = p.lastSeason
    ? `last season ${p.lastSeason.starts}/${p.lastSeason.teamMatches} starts, ${p.lastSeason.goals} goal${p.lastSeason.goals === 1 ? "" : "s"}`
    : "no league record last season";
  const listed = p.listed
    ? ` · LISTED${p.listed.askingFee ? ` (asking ${cr(p.listed.askingFee)})` : ""}: ${p.listed.reason}`
    : "";
  return `${withClub ? `${p.ref} · ` : `${p.shirt} · `}${p.name} · ${p.position}${withClub ? ` · ${p.club}` : ""} · overall ${p.overall} · ${rec} · wage ${cr(p.wage)}/round · guide fee ${cr(p.guide)}${listed}`;
}

function common(f: TransferFacts): string {
  const m = f.finances;
  return `Transfer window before ${f.window.season} (deadline ${f.window.deadline}). Players who move are registered with their new club for the whole of ${f.window.season}.

## Your memory
Summary: ${f.manager.memory.summary || "(none)"}
${f.manager.memory.notes.map((n) => `- ${n}`).join("\n")}

## Last season
${f.lastSeason ? `${f.lastSeason.name}: finished ${f.lastSeason.position} with ${f.lastSeason.points} points` : "(no completed season)"}

## Club finances (fictional credits)
Cash: ${cr(m.cash)}
League distribution due at kick-off: ${cr(m.distributionDue)}
Wages: ${cr(m.wagesPerRound)} a round × ${m.rounds} rounds = ${cr(m.seasonWages)}
Headroom (cash + distribution − wages): ${cr(m.headroom)}, before any result or prize income
A fee is paid in full when the deal settles at the deadline; the player's wage is then paid every round.

## Your squad (shirt · name · position · ability · record · wage · guide fee)
${f.squad.map((p) => playerLine(p, false)).join("\n")}

## Squad needs
${f.needs.map((n) => `- ${n}`).join("\n")}

## Rules (${f.format.playersPerTeam}-a-side)
- Up to ${f.rules.maxListings} listings and ${f.rules.maxBids} bids per club; minimum bid ${cr(f.rules.minFee)}; you can't bid more than your cash.
- Every squad keeps at least ${f.rules.minSquad} players and ${f.rules.goalkeepers} goalkeeper, and at most ${f.rules.maxSquad}.
- A seller may refuse any offer, however large.`;
}

export function transferSystem(f: TransferFacts): string {
  return `You are ${f.manager.name}, the AI manager of ${f.team.name} in Auto Soccer, a fictional ${f.format.playersPerTeam}-a-side league played in a deterministic 2D simulator.
Persona: ${f.manager.persona}
Philosophy: ${f.manager.philosophy}

Between seasons there is a short transfer window. Clubs list players they would sell, bid for other clubs' players, and decide on the offers they receive. Money is fictional credits (cr) in the club's treasury, not real money.
Only use the facts provided. Do not invent players, fees, injuries or quotes.`;
}

export function transferPrompt(f: TransferFacts): string {
  const base = common(f);
  if (f.phase === "listing")
    return `${base}

Decide which of your players, if any, you invite offers for (to cover wages, clear a surplus, or raise money for a signing). Listing doesn't oblige you to sell. Return listings by shirt number with an optional asking fee, and a short rationale.`;
  if (f.phase === "bidding")
    return `${base}

## Players at other clubs (ref · name · position · club · ability · record · wage · guide fee)
${(f.market ?? []).map((p) => playerLine(p, true)).join("\n")}

Decide whether to bid. Think about what your squad needs, the fee, and the wages you would add for every round. Return bids by market reference, or none, and a short rationale.`;
  return `${base}

## Offers received
${(f.offers ?? []).map((o) => `${o.label}: ${o.buyer} offer ${cr(o.fee)} for ${o.player} (${o.ref}) — "${o.buyerReason}"`).join("\n") || "(none)"}

Accept or reject each offer. You may accept at most one offer per player; you may refuse an affordable offer for sporting reasons. Return one decision per offer label, and a short rationale.`;
}
