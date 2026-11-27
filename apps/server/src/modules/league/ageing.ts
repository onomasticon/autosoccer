/**
 * ageing/1: players get older a year each season. Young players improve, players in their late
 * twenties hold steady, and from 30 the physical ratings fall, faster each year, until they retire.
 * Each retiree's place is taken by an academy graduate (17–19) of the same position.
 *
 * How fast a player develops and declines is their hidden development rate (0.6–1.6). It's stored
 * on the player, never served by the API and never shown to managers: you can only see its effect
 * in the ratings.
 *
 * Deterministic and idempotent: ages, rates, retirements and graduates' names and ratings all come
 * from hashes of the player (or club) and season, and every step is keyed so it runs once.
 */
import { createHash } from "node:crypto";
import { ATTRIBUTE_NAMES, type AttributeName, type PlayerAttributes, type Position } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { overallRating, playerAttributes } from "./attributes.ts";
import { KEY_ATTRIBUTES } from "./careers.ts";

export const AGEING_RULE = "ageing/1";

export const AGEING = {
  version: AGEING_RULE,
  /** Founders' and expansion players' ages when ageing first applies. */
  startingAge: { min: 18, max: 33 },
  /** Graduates join from the academy at this age. */
  graduateAge: { min: 17, max: 19 },
  /** The hidden development rate's range (graduates lean higher). */
  rate: { min: 0.6, max: 1.4, graduateMax: 1.6 },
  /** Graduates start this far below the deterministic baseline, then grow. */
  graduateDeficit: 7,
  /** Retirement: certain at `always`; from `from`, a chance that grows each year (higher for weak players). */
  retire: { from: 33, always: 36, chancePerYear: 0.25, weakBelow: 60, weakBonus: 0.25 },
} as const;

const unit = (key: string, byte = 0) => createHash("sha256").update(`ageing:${key}`).digest()[byte]! / 255;

/** A player's age when ageing first applies (18–33), from who they are. */
export function startingAge(name: string): number {
  const { min, max } = AGEING.startingAge;
  return min + Math.floor(unit(`age:${name}`) * (max - min + 1 - 1e-9));
}

/** The hidden development rate, 0.6–1.4 (graduates up to 1.6). */
export function developmentRate(name: string, graduate = false): number {
  const max = graduate ? AGEING.rate.graduateMax : AGEING.rate.max;
  return Math.round((AGEING.rate.min + unit(`rate:${name}`) * (max - AGEING.rate.min)) * 100) / 100;
}

/** The age a player is in a season (null before ageing applied to them). */
export const ageIn = (bornSeason: number | null | undefined, seasonNo: number | null) =>
  bornSeason == null || seasonNo == null ? null : seasonNo - bornSeason;

/**
 * What a season of age does, before the player's rate: + for the young, nothing at the peak,
 * − for the physical ratings from 30, steepening each year.
 */
export function ageEffect(age: number, position: Position): Array<{ attribute: AttributeName; base: number }> {
  const [k1, k2] = KEY_ATTRIBUTES[position];
  if (age <= 20)
    return [
      { attribute: k1, base: 2 },
      { attribute: k2, base: 2 },
      { attribute: "stamina", base: 1 },
    ];
  if (age <= 23)
    return [
      { attribute: k1, base: 1 },
      { attribute: k2, base: 1 },
    ];
  if (age <= 29) return [];
  if (age <= 31)
    return [
      { attribute: "pace", base: -1 },
      { attribute: "acceleration", base: -1 },
    ];
  if (age <= 33)
    return [
      { attribute: "pace", base: -1 },
      { attribute: "acceleration", base: -1 },
      { attribute: "stamina", base: -1 },
      { attribute: "agility", base: -1 },
    ];
  return [
    { attribute: "pace", base: -2 },
    { attribute: "acceleration", base: -2 },
    { attribute: "stamina", base: -2 },
    { attribute: "agility", base: -1 },
    { attribute: k1, base: -1 },
  ];
}

/**
 * The age effect scaled by the hidden rate, rounded up or down by a seeded draw (so a rate of 1.3
 * turns a +1 into +2 about a third of the time). Ratings never move by more than 2 a season in all.
 */
export function ageDeltas(age: number, position: Position, rate: number, seed: string) {
  return ageEffect(age, position)
    .map(({ attribute, base }, i) => {
      const x = Math.abs(base) * rate;
      const n = Math.floor(x) + (unit(`round:${seed}:${attribute}`, i % 32) < x - Math.floor(x) ? 1 : 0);
      return { attribute, delta: Math.sign(base) * n };
    })
    .filter((d) => d.delta !== 0);
}

/** Whether a player retires before a season they'd be `age` in (deterministic per player and season). */
export function retires(age: number, overall: number, seed: string): boolean {
  const r = AGEING.retire;
  if (age >= r.always) return true;
  if (age < r.from) return false;
  const chance = (age - r.from + 1) * r.chancePerYear + (overall < r.weakBelow ? r.weakBonus : 0);
  return unit(`retire:${seed}`) < chance;
}

const FIRST = [
  "Aiden",
  "Bela",
  "Cian",
  "Dalia",
  "Emre",
  "Fia",
  "Gideon",
  "Hessa",
  "Iker",
  "Jana",
  "Kian",
  "Lina",
  "Milo",
  "Nika",
  "Otis",
  "Pia",
  "Rami",
  "Suki",
  "Tavi",
  "Ulla",
  "Vane",
  "Wim",
  "Xena",
  "Yoan",
  "Zita",
  "Amos",
  "Bree",
  "Ciro",
  "Dov",
  "Ela",
  "Fenn",
  "Gala",
  "Hux",
  "Ines",
  "Jory",
  "Kaja",
  "Luz",
  "Mika",
  "Nero",
  "Oona",
];
const LAST = [
  "Arden",
  "Brandt",
  "Corso",
  "Dahl",
  "Ekwueme",
  "Ferrand",
  "Gale",
  "Hosseini",
  "Iwu",
  "Juarez",
  "Kaur",
  "Lindgren",
  "Mbeki",
  "Nordin",
  "Oduya",
  "Pace",
  "Quiroga",
  "Rios",
  "Strom",
  "Tamm",
  "Uddin",
  "Vega",
  "Wilde",
  "Yu",
  "Zeller",
  "Abara",
  "Bosch",
  "Cardenas",
  "Diallo",
  "Ekholm",
  "Faro",
  "Gill",
  "Hale",
  "Ivers",
  "Joshi",
];

/** A graduate's name: unique in the league, from the club, season and squad number. */
async function graduateName(db: Db, seed: string): Promise<string> {
  for (let i = 0; i < 64; i++) {
    const h = createHash("sha256").update(`graduate:${seed}:${i}`).digest();
    const name = `${FIRST[h[0]! % FIRST.length]} ${LAST[h[1]! % LAST.length]}`;
    const [taken] = await db`select 1 from players where name = ${name}`;
    if (!taken) return name;
  }
  return `Academy ${seed.slice(-6)}`;
}

/** A graduate's starting ratings: the deterministic baseline for who they are, minus the deficit. */
export function graduateAttributes(name: string, shirtNumber: number, position: Position): PlayerAttributes {
  const base = playerAttributes({ name, shirtNumber, position });
  return Object.fromEntries(
    ATTRIBUTE_NAMES.map((n) => [
      n,
      n === "goalkeeping" && position !== "GK" ? base[n] : Math.max(25, Math.min(95, base[n] - AGEING.graduateDeficit)),
    ]),
  ) as PlayerAttributes;
}

/** Gives every active player without an age one (from who they are), as of `seasonNo`. Idempotent. */
export async function ensureAges(db: Db, seasonNo: number): Promise<number> {
  const rows = await db<{ id: string; name: string }[]>`
    select id, name from players where born_season is null and retired_season_id is null`;
  for (const p of rows)
    await db`update players set born_season = ${seasonNo - startingAge(p.name)},
      development_rate = coalesce(development_rate, ${developmentRate(p.name)})
      where id = ${p.id} and born_season is null`;
  return rows.length;
}

export interface Retirement {
  playerId: string;
  name: string;
  teamId: string;
  position: Position;
  age: number;
  graduate: { playerId: string; name: string; age: number; shirtNumber: number };
}

/**
 * Before a new season (number `seasonNo`) is created from `lastSeasonId`: players who reach
 * retirement leave (retired_season_id = the season they last played), and each is replaced by an
 * academy graduate of the same position at the same club, so squads keep their size. Runs once
 * per season (a repeat returns what was done).
 */
export async function retireAndPromote(db: Db, lastSeasonId: string, seasonNo: number): Promise<Retirement[]> {
  await ensureAges(db, seasonNo - 1);
  return db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`ageing:${lastSeasonId}`}))`;
    const done = await tx<{ id: string }[]>`select id from players where academy_season_id = ${lastSeasonId} limit 1`;
    const rows = await tx<
      {
        id: string;
        name: string;
        team_id: string;
        position: Position;
        shirt_number: number;
        born_season: number;
        overall: number | null;
        base_attributes: PlayerAttributes | null;
      }[]
    >`
      select p.id, p.name, p.team_id, p.position, p.shirt_number, p.born_season, r.overall, p.base_attributes
      from players p join season_teams st on st.team_id = p.team_id and st.season_id = ${lastSeasonId}
      left join player_ratings r on r.player_id = p.id and r.season_id = ${lastSeasonId}
      where (p.retired_season_id is null or p.retired_season_id = ${lastSeasonId}) and p.born_season is not null
      order by p.team_id, p.shirt_number`;
    const out: Retirement[] = [];
    if (done.length) return retirementsAfter(tx as unknown as Db, lastSeasonId, seasonNo);
    for (const p of rows) {
      const age = seasonNo - p.born_season;
      const overall =
        p.overall ??
        overallRating(
          p.base_attributes ?? playerAttributes({ name: p.name, shirtNumber: p.shirt_number, position: p.position }),
          p.position,
        );
      if (!retires(age, overall, `${p.id}:${seasonNo}`)) continue;
      await tx`update players set retired_season_id = ${lastSeasonId} where id = ${p.id}`;
      // The graduate takes the retiree's shirt number.
      const shirt = p.shirt_number;
      const name = await graduateName(tx as unknown as Db, `${p.team_id}:${seasonNo}:${shirt}`);
      const { min, max } = AGEING.graduateAge;
      const gAge = min + Math.floor(unit(`gradage:${name}`) * (max - min + 1 - 1e-9));
      const [g] = await tx<{ id: string }[]>`
        insert into players (team_id, name, shirt_number, position, born_season, development_rate, base_attributes, academy_season_id)
        values (${p.team_id}, ${name}, ${shirt}, ${p.position}, ${seasonNo - gAge}, ${developmentRate(name, true)},
          ${tx.json(graduateAttributes(name, shirt, p.position) as never)}, ${lastSeasonId})
        returning id`;
      out.push({
        playerId: p.id,
        name: p.name,
        teamId: p.team_id,
        position: p.position,
        age,
        graduate: { playerId: g!.id, name, age: gAge, shirtNumber: shirt },
      });
    }
    return out;
  });
}

/** The retirements after a season and the graduates who replaced them, from the record. */
export async function retirementsAfter(db: Db, lastSeasonId: string, seasonNo: number): Promise<Retirement[]> {
  type Row = {
    id: string;
    name: string;
    team_id: string;
    position: Position;
    born_season: number;
    shirt_number: number;
  };
  const gone = await db<Row[]>`
    select id, name, team_id, position, born_season, shirt_number from players
    where retired_season_id = ${lastSeasonId} order by team_id, shirt_number`;
  const grads = await db<Row[]>`
    select id, name, team_id, position, born_season, shirt_number from players
    where academy_season_id = ${lastSeasonId} order by team_id, shirt_number`;
  const out: Retirement[] = [];
  for (const r of gone) {
    const g = grads.find(
      (x) => x.team_id === r.team_id && x.position === r.position && !out.some((o) => o.graduate.playerId === x.id),
    );
    if (!g) continue;
    out.push({
      playerId: r.id,
      name: r.name,
      teamId: r.team_id,
      position: r.position,
      age: seasonNo - r.born_season,
      graduate: { playerId: g.id, name: g.name, age: seasonNo - g.born_season, shirtNumber: g.shirt_number },
    });
  }
  return out;
}
