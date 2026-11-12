import {
  defaultTactics,
  TacticalConfigV1 as Schema,
  type TacticalConfigV1,
  type TeamSize,
} from "@autosoccer/contracts";
import { BASELINE_PARAMS, type ControllerParams, type ParamsResolver, type Slot } from "./controllers/index.ts";

type Tier = "def" | "dm" | "mid" | "midfwd" | "fwd";

/** Outfield slots per formation (shirt numbers 2–N, back to front, left to right). */
const FORMATIONS: Record<TacticalConfigV1["formation"], Array<{ tier: Tier; lateral: number }>> = {
  // 5-a-side: four outfield players.
  "2-1-1": [
    { tier: "def", lateral: -1 },
    { tier: "def", lateral: 1 },
    { tier: "mid", lateral: 0 },
    { tier: "fwd", lateral: 0.5 },
  ],
  "1-2-1": [
    { tier: "def", lateral: 0 },
    { tier: "mid", lateral: -1 },
    { tier: "mid", lateral: 1 },
    { tier: "fwd", lateral: 0 },
  ],
  "2-2": [
    { tier: "def", lateral: -1 },
    { tier: "def", lateral: 1 },
    { tier: "midfwd", lateral: -1 },
    { tier: "midfwd", lateral: 1 },
  ],
  "1-1-2": [
    { tier: "def", lateral: 0 },
    { tier: "mid", lateral: 0 },
    { tier: "fwd", lateral: -1 },
    { tier: "fwd", lateral: 1 },
  ],
  "3-1": [
    { tier: "def", lateral: -1.3 },
    { tier: "def", lateral: 0 },
    { tier: "def", lateral: 1.3 },
    { tier: "mid", lateral: 0 },
  ],
  // 7-a-side: six outfield players.
  "2-3-1": [
    { tier: "def", lateral: -1 },
    { tier: "def", lateral: 1 },
    { tier: "mid", lateral: -1.6 },
    { tier: "mid", lateral: 0 },
    { tier: "mid", lateral: 1.6 },
    { tier: "fwd", lateral: 0 },
  ],
  "3-2-1": [
    { tier: "def", lateral: -1.5 },
    { tier: "def", lateral: 0 },
    { tier: "def", lateral: 1.5 },
    { tier: "mid", lateral: -1 },
    { tier: "mid", lateral: 1 },
    { tier: "fwd", lateral: 0 },
  ],
  "2-2-2": [
    { tier: "def", lateral: -1 },
    { tier: "def", lateral: 1 },
    { tier: "mid", lateral: -1.2 },
    { tier: "mid", lateral: 1.2 },
    { tier: "fwd", lateral: -0.8 },
    { tier: "fwd", lateral: 0.8 },
  ],
  "3-1-2": [
    { tier: "def", lateral: -1.5 },
    { tier: "def", lateral: 0 },
    { tier: "def", lateral: 1.5 },
    { tier: "mid", lateral: 0 },
    { tier: "fwd", lateral: -0.9 },
    { tier: "fwd", lateral: 0.9 },
  ],
  "2-1-2-1": [
    { tier: "def", lateral: -1 },
    { tier: "def", lateral: 1 },
    { tier: "dm", lateral: 0 },
    { tier: "midfwd", lateral: -1.3 },
    { tier: "midfwd", lateral: 1.3 },
    { tier: "fwd", lateral: 0 },
  ],
};

/** Pitch each team size plays on (must match the simulator's config for that size). */
const PITCH: Record<TeamSize, { length: number; width: number }> = {
  5: { length: 50, width: 32 },
  7: { length: 60, width: 38 },
};

/** Depth (m from own goal line) of each tier by line height, on the 50 m 5-a-side pitch; scaled for 7-a-side. */
const DEPTH = {
  deep: { def: 7, mid: 13, fwd: 21 },
  mid: { def: 9, mid: 17, fwd: 27 },
  high: { def: 13, mid: 22, fwd: 32 },
} as const;
const WIDTH = { narrow: 3.5, balanced: 5, wide: 7.5 } as const;
const PRESS = {
  low: { pressers: 1, pressLine: 99, ballFollow: 0.2, sprint: false },
  mid: { pressers: 2, pressLine: 6, ballFollow: 0.3, sprint: true },
  high: { pressers: 2, pressLine: -10, ballFollow: 0.4, sprint: true },
} as const;
const TEMPO = {
  patient: { directness: 0.15, maxPassDistance: 16, backPassAllowance: 8, passArriveSpeed: 2.5 },
  balanced: { directness: 0.5, maxPassDistance: 22, backPassAllowance: 4, passArriveSpeed: 3 },
  direct: { directness: 0.9, maxPassDistance: 30, backPassAllowance: 1, passArriveSpeed: 4 },
} as const;
const RISK = { safe: 1.8, balanced: 1.2, risky: 0.7 } as const;
const SHOOT = { selective: 11, balanced: 15, early: 21 } as const;
const DRIBBLE = { rarely: 7, sometimes: 3.5, often: 2.2 } as const;
const PUSH = { deep: 2, mid: 4, high: 6 } as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic, total mapping from a tactics/1 config to controller params for a team size. */
export function tacticalParams(t: TacticalConfigV1, size: TeamSize = 5): ControllerParams {
  const shape = FORMATIONS[t.formation];
  if (shape.length !== size - 1)
    throw new Error(`formation ${t.formation} has ${shape.length} outfield players; ${size}-a-side needs ${size - 1}`);
  const sx = PITCH[size].length / PITCH[5].length;
  const sy = PITCH[size].width / PITCH[5].width;
  const depth = DEPTH[t.lineHeight];
  const w = WIDTH[t.width] * sy;
  const tierDepth = (tier: Tier) =>
    tier === "midfwd" ? (depth.mid + depth.fwd) / 2 : tier === "dm" ? (depth.def + depth.mid) / 2 : depth[tier];
  const slots = Object.fromEntries(
    shape.map((s, i) => [i + 2, { depth: r2(tierDepth(s.tier) * sx), lateral: r2(s.lateral * w) } satisfies Slot]),
  ) as ControllerParams["slots"];
  const press = PRESS[t.pressing];
  return {
    name: `tactics1-${t.formation}-${t.lineHeight}-${t.pressing}-${t.tempo}`,
    slots,
    ballFollow: press.ballFollow,
    ballShift: t.width === "narrow" ? 0.5 : 0.4,
    attackPush: PUSH[t.lineHeight],
    pushDepth: r2(14 * sx),
    pressLine: press.pressLine,
    pressers: press.pressers,
    sprint: press.sprint,
    shootRange: r2(SHOOT[t.shooting] * sx),
    passSafety: RISK[t.passingRisk],
    leadDistance: 1.5,
    dribbleSpace: DRIBBLE[t.dribbling],
    keeperRelease: t.keeperDistribution,
    ...TEMPO[t.tempo],
    maxPassDistance: r2(TEMPO[t.tempo].maxPassDistance * sx),
  };
}

/**
 * Resolver used by the adapter. `tactics/1` configs are parsed strictly and mapped;
 * an empty config means the baseline (the Phase-1 params in 5-a-side, kept so earlier
 * frozen requests replay identically; the default tactics in 7-a-side). Anything else
 * is an error — invalid tactics never reach the simulator.
 */
export const resolveTactics: ParamsResolver = (d, size = 5) => {
  if (d.schemaVersion !== "tactics/1") throw new Error(`unsupported tactics schema ${d.schemaVersion}`);
  if (Object.keys(d.config).length === 0)
    return size === 5 ? BASELINE_PARAMS : tacticalParams(defaultTactics(size), size);
  const parsed = Schema.safeParse(d.config);
  if (!parsed.success)
    throw new Error(
      `invalid tactics/1 config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  return tacticalParams(parsed.data, size);
};
