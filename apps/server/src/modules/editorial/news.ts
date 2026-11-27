/**
 * The league desk: news from off the pitch, written by the correspondent from official records,
 * in the league's own terms (the league, the clubs, their owners), never as release notes.
 *
 * Topics (one article per topic and subject, keyed like every article):
 *  - champions:  the final table, the margin, the champion's title count and the top scorer.
 *  - league:     changes to the league for a new season (clubs joining, the number of rounds, squad
 *                size, the money, transfer and bankruptcy rules coming into force). Only when
 *                something changed.
 *  - takeover:   a bankrupt club returning under new owners and a new name.
 *  - withdrawal: a club declared bankrupt mid-season, and what happens to its fixtures.
 *  - transfers:  the transfer window round-up, every completed deal with its fee.
 *  - finances:   what each club takes into the season: cash and the wage bill.
 *  - retirements: players who retired after last season, and the academy graduates replacing them.
 *
 * enqueueNews sweeps for these on every scheduler tick (idempotent job keys), looking only at the
 * newest two seasons, so a deploy never back-fills a league's whole history.
 */
import type { Fact, NewsTopic } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { enqueue } from "../../jobs/queue.ts";
import { formatCredits } from "../finance/rules.ts";
import { clubPosition } from "../finance/settle.ts";
import { teamsAsOf } from "../insolvency/takeover.ts";
import { scorers, standingRows } from "../league/read.ts";
import { raceFact, standingFacts } from "./facts.ts";
import { championsAt, inCycle, MATCH_MINUTES, newsAt, seasonClock, seasonEnd } from "./timing.ts";

export const NEWS_JOB = "article.news";

export interface NewsSubject {
  topic: NewsTopic;
  seasonId: string;
  teamId?: string | null;
}

export const newsKey = (s: NewsSubject) => `${NEWS_JOB}:${s.topic}:${s.seasonId}${s.teamId ? `:${s.teamId}` : ""}`;

export interface NewsStory {
  facts: Fact[];
  /** The fact every version of the story must cite (the news itself). */
  lead: string;
  priority: number;
  publishAt: Date;
  teamIds: string[];
  round: number;
}

/** How big each story is. Champions are the headline; a quiet window is minor news. */
export const NEWS_PRIORITY: Record<NewsTopic, number> = {
  champions: 100,
  withdrawal: 95,
  league: 75,
  takeover: 80,
  transfers: 70,
  finances: 55,
  retirements: 60,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));
const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
};

interface SeasonRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
  players_per_team: number;
  finance_rule: string | null;
  transfer_rule: string | null;
  insolvency_rule: string | null;
}

const seasonRow = async (db: Db, id: string) =>
  (
    await db<SeasonRow[]>`
      select id, name, slug, status, created_at, players_per_team, finance_rule, transfer_rule, insolvency_rule
      from seasons where id = ${id}`
  )[0] ?? null;

const previousSeason = async (db: Db, s: SeasonRow) =>
  (
    await db<SeasonRow[]>`
      select id, name, slug, status, created_at, players_per_team, finance_rule, transfer_rule, insolvency_rule
      from seasons where created_at < ${s.created_at} order by created_at desc limit 1`
  )[0] ?? null;

const fact = (id: string, statement: string, value: unknown, table: string): Fact => ({
  id,
  kind: "news",
  statement,
  value,
  source: { table, id },
});

async function champions(db: Db, s: SeasonRow): Promise<NewsStory | null> {
  if (s.status !== "completed") return null;
  const clock = await seasonClock(db, s.id);
  const { rows } = await standingRows(db, s.id);
  const [top, second] = rows;
  if (!top || top.played === 0 || top.withdrawn) return null;
  const titles = await db<{ id: string }[]>`
    select id from seasons where status = 'completed'
      and created_at <= (select created_at from seasons where id = ${s.id}) order by created_at`;
  let count = 0;
  for (const t of titles) if ((await standingRows(db, t.id)).rows[0]?.team.id === top.team.id) count++;
  const margin = second ? top.points - second.points : null;
  const lead = `news:champions:${s.id}`;
  const facts: Fact[] = [
    fact(
      lead,
      `${top.team.name} are the ${s.name} champions with ${plural(top.points, "point")} from ${plural(top.played, "match", "matches")}${
        second
          ? margin === 0
            ? `, level on points with ${second.team.name} and ahead on tie-breaks`
            : `, ${plural(margin!, "point")} clear of ${second.team.name}`
          : ""
      }`,
      { team: { id: top.team.id, name: top.team.name }, points: top.points, margin },
      "seasons",
    ),
    fact(
      `news:champions:${s.id}:titles`,
      count === 1
        ? `It is ${top.team.name}'s first league title`
        : `It is ${top.team.name}'s ${ordinal(count)} league title`,
      { team: top.team.name, titles: count },
      "seasons",
    ),
  ];
  const [scorer] = await scorers(db, s.id, 1);
  if (scorer)
    facts.push(
      fact(
        `news:champions:${s.id}:scorer`,
        `${scorer.name} of ${scorer.team.name} finished as the ${s.name} top scorer with ${plural(scorer.goals, "goal")}`,
        { player: scorer.name, team: scorer.team.name, goals: scorer.goals },
        "matches",
      ),
    );
  facts.push(...(await standingFacts(db, s.id, clock.lastRound)), ...(await raceFact(db, s.id, clock.lastRound)));
  const last = clock.kickoffs.get(clock.lastRound);
  return {
    facts,
    lead,
    priority: NEWS_PRIORITY.champions,
    publishAt: last ? championsAt(last, clock.gap) : new Date(),
    teamIds: [top.team.id],
    round: clock.lastRound,
  };
}

/** What changed about the league between the previous season and this one, in the league's terms. */
async function league(db: Db, s: SeasonRow): Promise<NewsStory | null> {
  const prev = await previousSeason(db, s);
  if (!prev) return null;
  const clubs = async (id: string) =>
    (await db<{ team_id: string }[]>`select team_id from season_teams where season_id = ${id}`).map((r) => r.team_id);
  const [now, before] = [await clubs(s.id), await clubs(prev.id)];
  const teams = await teamsAsOf(db, s.id);
  const joined = now.filter((t) => !before.includes(t)).map((t) => teams.get(t)!);
  const left = before.filter((t) => !now.includes(t)).length;
  const rounds = async (id: string) =>
    (await db<{ n: number }[]>`select count(distinct round)::int as n from fixtures where season_id = ${id}`)[0]!.n;
  const [r, rPrev] = [await rounds(s.id), await rounds(prev.id)];
  const facts: Fact[] = [];
  const lead = `news:league:${s.id}`;
  if (joined.length)
    facts.push(
      fact(
        `${lead}:joined`,
        `${list(joined.map((t) => t.name))} ${joined.length === 1 ? "joins" : "join"} the league for ${s.name}`,
        { clubs: joined.map((t) => ({ id: t.id, name: t.name, city: t.city })) },
        "season_teams",
      ),
    );
  if (r !== rPrev)
    facts.push(
      fact(
        `${lead}:rounds`,
        `${s.name} is played over ${plural(r, "round")}, ${r > rPrev ? "up" : "down"} from ${rPrev} last season`,
        { rounds: r, previous: rPrev },
        "fixtures",
      ),
    );
  if (s.players_per_team !== prev.players_per_team)
    facts.push(
      fact(
        `${lead}:squads`,
        `Matches are ${s.players_per_team}-a-side from ${s.name}, after ${prev.players_per_team}-a-side last season`,
        { playersPerTeam: s.players_per_team, previous: prev.players_per_team },
        "seasons",
      ),
    );
  if (s.finance_rule && !prev.finance_rule)
    facts.push(
      fact(
        `${lead}:money`,
        `From ${s.name}, every club runs on its own money: it earns from results, a season distribution and a finishing prize, and pays its players' wages every round`,
        { rule: s.finance_rule },
        "seasons",
      ),
    );
  if (s.finance_rule && prev.finance_rule && s.finance_rule !== prev.finance_rule)
    facts.push(
      fact(
        `${lead}:money-rules`,
        `New money rules from ${s.name}: wages and result income are now season amounts paid in equal shares over all ${plural(r, "round")}, so a longer season costs and earns clubs about the same, and finishing prizes are paid down to 10th place`,
        { rule: s.finance_rule, previous: prev.finance_rule },
        "seasons",
      ),
    );
  if (joined.length) {
    const managers = await db<{ team_id: string; name: string }[]>`
      select team_id, name from manager_agents where team_id = any(${joined.map((t) => t.id)})`;
    const by = new Map(managers.map((m) => [m.team_id, m.name]));
    if (managers.length)
      facts.push(
        fact(
          `${lead}:managers`,
          `Each new club has its own AI manager: ${list(joined.filter((t) => by.has(t.id)).map((t) => `${by.get(t.id)} at ${t.name}`))}`,
          { managers: Object.fromEntries(joined.map((t) => [t.name, by.get(t.id) ?? null])) },
          "manager_agents",
        ),
      );
  }
  if (s.transfer_rule && !prev.transfer_rule)
    facts.push(
      fact(
        `${lead}:transfers`,
        `A transfer window now opens before each season, when clubs can buy and sell players for fees`,
        { rule: s.transfer_rule },
        "seasons",
      ),
    );
  if (s.insolvency_rule && !prev.insolvency_rule)
    facts.push(
      fact(
        `${lead}:bankruptcy`,
        `From ${s.name}, a club that can't pay a round's wages is declared bankrupt and withdrawn for the rest of the season; its remaining fixtures are walkovers`,
        { rule: s.insolvency_rule },
        "seasons",
      ),
    );
  if (!facts.length) return null;
  facts.unshift(
    fact(
      lead,
      now.length !== before.length
        ? `The league ${now.length > before.length ? "expands" : "shrinks"} from ${before.length} to ${now.length} clubs for ${s.name}`
        : `The league confirms changes for ${s.name}`,
      { clubs: now.length, previous: before.length, left },
      "seasons",
    ),
  );
  const clock = await seasonClock(db, prev.id);
  return {
    facts,
    lead,
    priority: now.length > before.length ? 90 : NEWS_PRIORITY.league,
    publishAt: inCycle(await seasonEnd(db, prev.id), 75, clock.gap, s.created_at),
    teamIds: joined.map((t) => t.id),
    round: 1,
  };
}

async function takeover(db: Db, s: SeasonRow, teamId: string): Promise<NewsStory | null> {
  const [i] = await db<{ name: string; memo: string; takeover_of_season_id: string; created_at: Date }[]>`
    select name, memo, takeover_of_season_id, created_at from team_identities
    where team_id = ${teamId} and from_season_id = ${s.id} and reason = 'takeover'`;
  if (!i) return null;
  const from = await seasonRow(db, i.takeover_of_season_id);
  const old = (await teamsAsOf(db, i.takeover_of_season_id)).get(teamId);
  const [w] = await db<{ effective_round: number }[]>`
    select effective_round from club_withdrawals where season_id = ${i.takeover_of_season_id} and team_id = ${teamId}`;
  const [cap] = await db<{ amount: string }[]>`
    select amount::text from club_ledger where key = ${`takeover:${i.takeover_of_season_id}:${teamId}`}`;
  const lead = `news:takeover:${s.id}:${teamId}`;
  const facts: Fact[] = [
    fact(
      lead,
      `${old?.name ?? "The club"} ${old ? "have" : "has"} been taken over by new owners and will play ${s.name} as ${i.name}`,
      { from: old?.name ?? null, to: i.name },
      "team_identities",
    ),
    fact(
      `${lead}:why`,
      `${old?.name ?? i.name} withdrew from ${from?.name ?? "last season"}${w ? ` before round ${w.effective_round}` : ""} after failing to pay their players' wages`,
      { round: w?.effective_round ?? null },
      "club_withdrawals",
    ),
    fact(
      `${lead}:kept`,
      `${i.name} keep their place in the league, their squad, their manager and their honours`,
      {},
      "team_identities",
    ),
  ];
  if (cap)
    facts.push(
      fact(
        `${lead}:capital`,
        `The new owners put in ${formatCredits(Number(cap.amount))} of fresh capital`,
        { capital: Number(cap.amount) },
        "club_ledger",
      ),
    );
  const prev = await previousSeason(db, s);
  const gap = prev ? (await seasonClock(db, prev.id)).gap : 240;
  return {
    facts,
    lead,
    priority: NEWS_PRIORITY.takeover,
    publishAt: inCycle(prev ? await seasonEnd(db, prev.id) : null, 80, gap, i.created_at),
    teamIds: [teamId],
    round: 1,
  };
}

async function withdrawal(db: Db, s: SeasonRow, teamId: string): Promise<NewsStory | null> {
  const [w] = await db<{ effective_round: number; reason: string; declared_at: Date }[]>`
    select effective_round, reason, declared_at from club_withdrawals where season_id = ${s.id} and team_id = ${teamId}`;
  if (!w) return null;
  const team = (await teamsAsOf(db, s.id)).get(teamId)!;
  const [left] = await db<{ n: number }[]>`
    select count(*)::int as n from fixtures where season_id = ${s.id} and round >= ${w.effective_round}
      and ${teamId}::uuid in (home_team_id, away_team_id)`;
  const lead = `news:withdrawal:${s.id}:${teamId}`;
  const facts: Fact[] = [
    fact(
      lead,
      `${team.name} have been declared bankrupt and withdrawn from ${s.name} before round ${w.effective_round}`,
      { team: team.name, round: w.effective_round },
      "club_withdrawals",
    ),
    fact(`${lead}:reason`, w.reason.replace(/\.$/, ""), { reason: w.reason }, "club_withdrawals"),
    fact(
      `${lead}:fixtures`,
      `${possessive(team.name)} remaining ${plural(left!.n, "fixture")} ${left!.n === 1 ? "is a walkover" : "are walkovers"}: each opponent is awarded 3 points, with no goals`,
      { fixtures: left!.n },
      "fixtures",
    ),
    fact(
      `${lead}:record`,
      `${possessive(team.name)} results so far stand, but they finish bottom and can't win the title or a prize`,
      {},
      "club_withdrawals",
    ),
  ];
  if (w.effective_round > 1) facts.push(...(await standingFacts(db, s.id, w.effective_round - 1)));
  const clock = await seasonClock(db, s.id);
  const prevKick = clock.kickoffs.get(w.effective_round - 1);
  return {
    facts,
    lead,
    priority: NEWS_PRIORITY.withdrawal,
    // The check runs as soon as the previous round is over: just after its round piece.
    publishAt: inCycle(
      prevKick ? new Date(prevKick.getTime() + MATCH_MINUTES * 60_000) : null,
      45,
      clock.gap,
      w.declared_at,
    ),
    teamIds: [teamId],
    round: w.effective_round,
  };
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

async function windowRow(db: Db, seasonId: string) {
  return (
    await db<{ id: string; closed_at: Date | null; deadline: Date }[]>`
      select id, closed_at, deadline from transfer_windows where season_id = ${seasonId} and phase = 'closed'`
  )[0];
}

async function transfers(db: Db, s: SeasonRow): Promise<NewsStory | null> {
  const w = await windowRow(db, s.id);
  if (!w) return null;
  const deals = await db<
    { id: string; player: string; position: string; seller: string; buyer: string; fee: string }[]
  >`
    select b.id, p.name as player, p.position, b.seller_team_id as seller, b.buyer_team_id as buyer, b.fee::text
    from transfer_bids b join players p on p.id = b.player_id
    where b.window_id = ${w.id} and b.status = 'completed' order by b.fee desc, p.name`;
  const statuses = await db<{ status: string; n: number }[]>`
    select status, count(*)::int as n from transfer_bids where window_id = ${w.id} group by status`;
  const count = (s: string) => statuses.find((x) => x.status === s)?.n ?? 0;
  const offers = statuses.reduce((a, x) => a + x.n, 0);
  const outcomes = [
    [count("completed"), "completed"],
    [count("rejected"), "turned down"],
    [count("outbid"), "beaten by a rival offer"],
    [count("lapsed"), "left unanswered"],
    [count("failed"), "fell through at the last check"],
  ].filter(([n]) => Number(n) > 0) as Array<[number, string]>;
  const teams = await teamsAsOf(db, s.id);
  const name = (id: string) => teams.get(id)?.name ?? "another club";
  const total = deals.reduce((a, d) => a + Number(d.fee), 0);
  const lead = `news:transfers:${s.id}`;
  const facts: Fact[] = [
    fact(
      lead,
      deals.length
        ? `The ${s.name} transfer window has closed with ${plural(deals.length, "completed transfer")} worth ${formatCredits(total)} in all`
        : `The ${s.name} transfer window has closed without a completed transfer`,
      { deals: deals.length, total },
      "transfer_windows",
    ),
    ...(offers
      ? [
          fact(
            `${lead}:offers`,
            `Clubs made ${plural(offers, "offer")} in the window: ${list(outcomes.map(([n, what]) => `${n} ${what}`))}`,
            Object.fromEntries(statuses.map((x) => [x.status, x.n])),
            "transfer_bids",
          ),
        ]
      : []),
    ...deals.map((d) =>
      fact(
        `${lead}:deal:${d.id}`,
        `${d.player} moves from ${name(d.seller)} to ${name(d.buyer)} for ${formatCredits(Number(d.fee))}`,
        { player: d.player, position: d.position, from: name(d.seller), to: name(d.buyer), fee: Number(d.fee) },
        "transfer_bids",
      ),
    ),
  ];
  const prev = await previousSeason(db, s);
  const gap = prev ? (await seasonClock(db, prev.id)).gap : 240;
  return {
    facts,
    lead,
    priority: deals.length ? NEWS_PRIORITY.transfers : 45,
    publishAt: newsAt(w.closed_at ?? w.deadline, prev ? await seasonEnd(db, prev.id) : null, 90, gap),
    teamIds: [...new Set(deals.flatMap((d) => [d.buyer, d.seller]))],
    round: 1,
  };
}

async function finances(db: Db, s: SeasonRow): Promise<NewsStory | null> {
  if (!s.finance_rule) return null;
  const w = s.transfer_rule ? await windowRow(db, s.id) : null;
  if (s.transfer_rule && !w) return null; // after the window, when the squads and cash are settled
  const teams = await teamsAsOf(db, s.id);
  const ids = (await db<{ team_id: string }[]>`select team_id from season_teams where season_id = ${s.id}`).map(
    (r) => r.team_id,
  );
  const clubs: Array<{ id: string; name: string; cash: number; wages: number; rounds: number }> = [];
  for (const id of ids) {
    const p = await clubPosition(db, s.id, id);
    if (p)
      clubs.push({ id, name: teams.get(id)!.name, cash: p.balance, wages: p.payrollPerRound, rounds: p.roundsToPay });
  }
  if (!clubs.length) return null;
  clubs.sort((a, b) => b.cash - a.cash || a.name.localeCompare(b.name));
  const lead = `news:finances:${s.id}`;
  const richest = clubs[0]!;
  const tightest = [...clubs].sort((a, b) => a.cash / a.wages - b.cash / b.wages)[0]!;
  const facts: Fact[] = [
    fact(
      lead,
      `${richest.name} go into ${s.name} with the most money: ${formatCredits(richest.cash)}`,
      { team: richest.name, cash: richest.cash },
      "club_ledger",
    ),
    ...clubs.map((c) =>
      fact(
        `${lead}:${c.id}`,
        `${c.name} start ${s.name} with ${formatCredits(c.cash)} and a wage bill of ${formatCredits(c.wages)} a round`,
        { team: c.name, cash: c.cash, wagesPerRound: c.wages, rounds: c.rounds },
        "club_ledger",
      ),
    ),
    fact(
      `${lead}:runway`,
      `${tightest.name} have the least room: their money covers ${plural(Math.floor(tightest.cash / Math.max(1, tightest.wages)), "round")} of wages without further income`,
      { team: tightest.name },
      "club_ledger",
    ),
  ];
  const prev = await previousSeason(db, s);
  const gap = prev ? (await seasonClock(db, prev.id)).gap : 240;
  const happened = w
    ? new Date((w.closed_at ?? w.deadline).getTime() + 20 * 60_000 * Math.min(1, gap / 240))
    : s.created_at;
  return {
    facts,
    lead,
    priority: NEWS_PRIORITY.finances,
    publishAt: newsAt(happened, prev ? await seasonEnd(db, prev.id) : null, 110, gap),
    teamIds: [],
    round: 1,
  };
}

const POSITION: Record<string, string> = { GK: "goalkeeper", DF: "defender", MF: "midfielder", FW: "forward" };

async function retirements(db: Db, s: SeasonRow): Promise<NewsStory | null> {
  const prev = await previousSeason(db, s);
  if (!prev) return null;
  const seasonNo = Number(/(\d+)$/.exec(s.slug)?.[1] ?? Number.NaN);
  const gone = await db<{ id: string; name: string; team_id: string; born_season: number | null; position: string }[]>`
    select id, name, team_id, born_season, position from players where retired_season_id = ${prev.id} order by team_id, name`;
  if (!gone.length) return null;
  const grads = await db<
    { id: string; name: string; team_id: string; born_season: number | null; position: string; shirt_number: number }[]
  >`
    select id, name, team_id, born_season, position, shirt_number from players where academy_season_id = ${prev.id}
    order by team_id, shirt_number`;
  const teams = await teamsAsOf(db, prev.id);
  const now = await teamsAsOf(db, s.id);
  const record = async (playerId: string) =>
    (
      await db<{ seasons: number; goals: number }[]>`
        select (select count(*)::int from player_registrations r where r.player_id = ${playerId}) as seasons,
          (select count(*)::int from matches m cross join lateral jsonb_array_elements(m.events) e
           where m.status = 'completed' and e->>'type' = 'goal' and e->>'scorerId' = ${playerId}
             and coalesce((e->>'ownGoal')::boolean, false) = false) as goals`
    )[0]!;
  const lead = `news:retirements:${s.id}`;
  const facts: Fact[] = [
    fact(
      lead,
      `${plural(gone.length, "player")} ${gone.length === 1 ? "has" : "have"} retired after ${prev.name}, and ${plural(grads.length, "academy graduate")} ${grads.length === 1 ? "steps" : "step"} up to replace them`,
      { retired: gone.length, graduates: grads.length },
      "players",
    ),
  ];
  for (const p of gone) {
    const r = await record(p.id);
    // The age they retire at: the age they would have been this season.
    const age = Number.isFinite(seasonNo) && p.born_season != null ? seasonNo - p.born_season : null;
    facts.push(
      fact(
        `${lead}:retired:${p.id}`,
        `${p.name}, ${possessive(teams.get(p.team_id)?.name ?? "a club")} ${POSITION[p.position] ?? "player"}, retires${age !== null ? ` at ${age}` : ""} after ${plural(r.seasons, "season")} in the league, with ${plural(r.goals, "league goal")}`,
        { player: p.name, age, seasons: r.seasons, goals: r.goals },
        "players",
      ),
    );
  }
  for (const g of grads)
    facts.push(
      fact(
        `${lead}:graduate:${g.id}`,
        `${now.get(g.team_id)?.name ?? "A club"} promote ${g.name}${Number.isFinite(seasonNo) && g.born_season != null ? `, ${seasonNo - g.born_season},` : ""} a ${POSITION[g.position] ?? "player"} from their academy, who takes the number ${g.shirt_number} shirt`,
        { player: g.name, shirt: g.shirt_number },
        "players",
      ),
    );
  const clock = await seasonClock(db, prev.id);
  return {
    facts,
    lead,
    priority: NEWS_PRIORITY.retirements,
    publishAt: inCycle(await seasonEnd(db, prev.id), 85, clock.gap, s.created_at),
    teamIds: [...new Set(gone.map((p) => p.team_id))],
    round: 1,
  };
}

/** The facts and placement of one news story, or null when there's nothing to report. */
export async function newsStory(db: Db, subject: NewsSubject): Promise<NewsStory | null> {
  const s = await seasonRow(db, subject.seasonId);
  if (!s) return null;
  switch (subject.topic) {
    case "champions":
      return champions(db, s);
    case "league":
      return league(db, s);
    case "takeover":
      return subject.teamId ? takeover(db, s, subject.teamId) : null;
    case "withdrawal":
      return subject.teamId ? withdrawal(db, s, subject.teamId) : null;
    case "transfers":
      return transfers(db, s);
    case "finances":
      return finances(db, s);
    case "retirements":
      return retirements(db, s);
  }
}

/**
 * Enqueues the news due in the newest two seasons (call every scheduler tick; idempotent by key).
 * The job itself decides whether there's a story (e.g. a season with no changes gets no league news).
 */
export async function enqueueNews(db: Db): Promise<number> {
  const seasons = await db<{ id: string; status: string; window_closed: boolean }[]>`
    select s.id, s.status,
      exists (select 1 from transfer_windows w where w.season_id = s.id and w.phase = 'closed') as window_closed
    from seasons s order by s.created_at desc limit 2`;
  const subjects: NewsSubject[] = [];
  for (const [i, s] of seasons.entries()) {
    if (s.status === "completed") subjects.push({ topic: "champions", seasonId: s.id });
    if (i === 0) subjects.push({ topic: "league", seasonId: s.id }, { topic: "retirements", seasonId: s.id });
    if (s.window_closed) subjects.push({ topic: "transfers", seasonId: s.id }, { topic: "finances", seasonId: s.id });
    for (const w of await db<{ team_id: string }[]>`select team_id from club_withdrawals where season_id = ${s.id}`)
      subjects.push({ topic: "withdrawal", seasonId: s.id, teamId: w.team_id });
    for (const t of await db<{ team_id: string }[]>`
      select team_id from team_identities where from_season_id = ${s.id} and reason = 'takeover'`)
      subjects.push({ topic: "takeover", seasonId: s.id, teamId: t.team_id });
  }
  // A season without a finance rule has no finances story; without a window, no round-up (the job skips).
  for (const subject of subjects)
    await enqueue(db, { kind: NEWS_JOB, key: newsKey(subject), payload: { ...subject }, maxAttempts: 3 });
  return subjects.length;
}
