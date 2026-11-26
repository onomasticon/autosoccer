/**
 * Bankruptcy demo on the configured DATABASE_URL (use a throwaway database), through the normal
 * season lifecycle: Season 1 with offline managers; in the Season 2 transfer window one club's
 * manager makes a reckless signing (nearly all its cash on one player, a solvent club's bad
 * decision); Season 2 is played until the payroll check finds the club can't pay a round's wages,
 * so it withdraws and its remaining fixtures become walkovers; rollover brings it back under new
 * owners and a new name for Season 3, and round 1 of Season 3 is played.
 *
 *   DATABASE_URL=postgres://…/demo bun scripts/bankruptcy-demo.ts [--club northgate-comets] [--rounds 1]
 */
import { createDb, migrate } from "@autosoccer/db";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { OfflineLlm } from "../apps/server/src/modules/agents/llm.ts";
import { offlinePostMatch, offlinePreMatch } from "../apps/server/src/modules/agents/offline.ts";
import type { ManagerFacts, PostMatchFacts } from "../apps/server/src/modules/agents/prompts.ts";
import { managerRoundHook, seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { formatCredits } from "../apps/server/src/modules/finance/rules.ts";
import { standingRows } from "../apps/server/src/modules/league/read.ts";
import { rolloverSeason } from "../apps/server/src/modules/league/rollover.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { offlineBidding, offlineListing, offlineReplying } from "../apps/server/src/modules/transfers/offline.ts";
import type { BidDecision, TransferFacts } from "../apps/server/src/modules/transfers/prompts.ts";
import { tickTransfers } from "../apps/server/src/modules/transfers/window.ts";

const MODEL = "claude-opus-5-5";
const arg = (n: string, d: string) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d;
const CLUB = arg("club", "northgate-comets");
const ROUNDS = Number(arg("rounds", "1"));
const club = SEED_TEAMS.find((t) => t.slug === CLUB)!;

const db = createDb(process.env.DATABASE_URL!, { max: 4 });
await migrate(db);
await seedTeams(db);
const [{ id: clubId }] = (await db<{ id: string }[]>`select id from teams where slug = ${CLUB}`) as unknown as [
  { id: string },
];

// Offline managers, except that one club's manager spends almost everything on the market's best
// player in the Season 2 window (and every seller takes an offer that large).
let reckless = true;
const llm = new OfflineLlm(MODEL, {
  "manager.pre_match": (c) => offlinePreMatch(c as ManagerFacts),
  "manager.post_match": (c) => offlinePostMatch(c as PostMatchFacts),
  "transfer.listing": (c) => offlineListing(c as TransferFacts),
  "transfer.bidding": (c): BidDecision => {
    const f = c as TransferFacts;
    if (!reckless || f.team.name !== club.name) return offlineBidding(f);
    const star = [...(f.market ?? [])].sort((a, b) => b.overall - a.overall || b.guide - a.guide)[0]!;
    const fee = Math.floor((f.finances.cash - 150_000) / 50_000) * 50_000;
    return {
      bids: [{ player: star.ref, fee, reason: `${star.name} is the best player in the league. We go all in.` }],
      rationale: "Everything on one signing: the title is worth it.",
    };
  },
  "transfer.replying": (c) => offlineReplying(c as TransferFacts),
});
const worker = createWorker({
  db,
  baseBackoffMs: 1,
  handlers: buildHandlers({ db, store: new MemoryReplayStore(), llm, halfDurationSec: 30 }),
});
const hook = managerRoundHook(db);
const play = async (seasonId: string, upTo = 99) => {
  for (let i = 0; i < 80; i++) {
    const [open] = await db<{ round: number | null }[]>`
      select min(round)::int as round from fixtures where season_id = ${seasonId} and status <> 'completed'`;
    if (open?.round != null && open.round > upTo) break;
    if ((await advanceSeason(db, seasonId, { beforeRound: hook })).state === "completed") break;
    await worker.drain();
  }
};
const runWindow = async (seasonId: string) => {
  for (let i = 0; i < 20; i++) {
    const [w] = await db<{ phase: string }[]>`select phase from transfer_windows where season_id = ${seasonId}`;
    if (!w || w.phase === "closed") break;
    await tickTransfers(db);
    await worker.drain();
  }
};
const cash = async () =>
  Number(
    (
      await db<{ b: string }[]>`select coalesce(sum(amount), 0)::text as b from club_ledger where team_id = ${clubId}`
    )[0]!.b,
  );
const statement: Array<[string, string]> = [];
const note = async (label: string) => statement.push([label, formatCredits(await cash())]);
const rollover = async () => {
  const slug = await rolloverSeason(db, { managerModel: MODEL, editorialModel: MODEL, roundMinutes: 60, clubs: 4 });
  return (await db<{ id: string }[]>`select id from seasons where slug = ${slug}`)[0]!.id;
};

const { seasonId: s1 } = await createSeason(db, {
  slug: "season-1",
  name: "Season 1",
  seed: 20261125,
  budgetPerTeamMicroUsd: 1_000_000,
  teamSlugs: SEED_TEAMS.map((x) => x.slug),
  startsAt: new Date(Date.now() - 48 * 3600_000),
  roundIntervalMinutes: 60,
  playersPerTeam: 7,
});
await seedManagers(db, s1, MODEL);
await play(s1);
await note("Cash after Season 1");
const s2 = await rollover();
await runWindow(s2);
reckless = false;
const [deal] = await db<{ player: string; seller: string; fee: string; status: string; reason: string | null }[]>`
  select p.name as player, ts.name as seller, b.fee::text, b.status, b.seller_reason as reason from transfer_bids b
  join players p on p.id = b.player_id join teams ts on ts.id = b.seller_team_id
  where b.buyer_team_id = ${clubId} order by b.created_at limit 1`;
await note("Cash after the Season 2 window");
await play(s2);
const [w] = await db<{ effective_round: number; reason: string; basis: { balance: number; wages: number } }[]>`
  select effective_round, reason, basis from club_withdrawals where season_id = ${s2} and team_id = ${clubId}`;
if (w) statement.push([`Cash at the round ${w.effective_round} check`, formatCredits(w.basis.balance)]);
await note("Cash after Season 2");
const s3 = await rollover();
await note("Cash after the takeover");
await runWindow(s3);
if (ROUNDS > 0) await play(s3, ROUNDS);
await note(`Cash after Season 3 round ${ROUNDS}`);

const { rows } = await standingRows(db, s2);
const [now] = await db<{ name: string }[]>`select name from teams where id = ${clubId}`;
const walkovers = await db<{ round: number; outcome: string }[]>`
  select round, outcome from fixtures where season_id = ${s2} and outcome is not null order by round`;
const [r1] = await db<{ outcome: string | null; matches: number }[]>`
  select f.outcome, (select count(*)::int from matches m where m.fixture_id = f.id) as matches from fixtures f
  where f.season_id = ${s3} and f.round = 1 and ${clubId}::uuid in (f.home_team_id, f.away_team_id)`;
console.log(
  `\nThe reckless signing: ${deal ? `${deal.player} from ${deal.seller} for ${formatCredits(Number(deal.fee))} (${deal.status}${deal.reason ? `: ${deal.reason}` : ""})` : "none"}`,
);
console.log(w ? `Bankrupt: withdrawn from Season 2 before round ${w.effective_round}. ${w.reason}` : "Not bankrupt.");
console.log(`Forfeits: ${walkovers.map((f) => `R${f.round} ${f.outcome}`).join(", ") || "none"}`);
console.log("\nSeason 2 table:");
console.table(
  rows.map((r) => ({
    pos: r.position,
    club: r.team.name,
    P: r.played,
    W: r.won,
    L: r.lost,
    GD: r.goalDifference,
    Pts: r.points,
    wo: r.walkovers,
    withdrawn: r.withdrawn ? `R${r.withdrawn.round}` : "",
  })),
);
console.log(`\n${club.name} statement:`);
console.table(Object.fromEntries(statement));
console.log(`Season 3: plays as ${now!.name}; round 1 fixture ${r1?.matches ? "played" : "not played"}.`);
await db.end();
