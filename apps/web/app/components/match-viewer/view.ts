/**
 * Pure view maths for the replay renderer: kit colours that stay apart, the optional follow-ball
 * camera, and mapping between screen and pitch coordinates (for tap-to-identify). Display only:
 * nothing here changes what the replay records.
 */
import type { Frame } from "./replay-adapter";

export const MARGIN = 2.5; // metres of run-off drawn around the pitch

export interface PitchDims {
  length: number;
  width: number;
}

export interface Camera {
  /** Pitch point (m) at the centre of the view. */
  cx: number;
  cy: number;
  /** 1 = the whole pitch. */
  zoom: number;
}

export const FULL_VIEW: Camera = { cx: 0, cy: 0, zoom: 1 };

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/** Perceptual-ish distance between two colours (weighted RGB, 0–~765). */
export function colourDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a) as [number, number, number];
  const [r2, g2, b2] = rgb(b) as [number, number, number];
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

/** Below this the two kits are hard to tell apart on the pitch. */
export const CLASH = 150;

/** The pitch's mid stripe colour (draw.ts), which shirts must also stand out from. */
export const PITCH_GREEN = "#3c9539";
/** Shirts closer than this to the pitch melt into it. */
export const PITCH_CLASH = 170;

/**
 * Shirt colours for the two sides (display only). Each side wears its primary unless it melts into
 * the pitch, then its secondary; the away side also changes if it clashes with the home shirt.
 * White and ink are the last resorts.
 */
export function kitColours(
  home: { primary: string; secondary: string },
  away: { primary: string; secondary: string },
): { home: string; away: string; changed: boolean } {
  const onPitch = (c: string) => colourDistance(c, PITCH_GREEN) >= PITCH_CLASH;
  const pick = (k: { primary: string; secondary: string }, avoid?: string) =>
    [k.primary, k.secondary, "#FFFFFF", "#20203B"].find(
      (c) => onPitch(c) && (!avoid || colourDistance(c, avoid) >= CLASH),
    ) ?? k.primary;
  const h = pick(home);
  const a = pick(away, h);
  return { home: h, away: a, changed: h !== home.primary || a !== away.primary };
}

/** Follow-ball camera: centred on the ball, clamped so the view never leaves the pitch area. */
export function followCamera(pitch: PitchDims, ball: { x: number; y: number }, zoom: number): Camera {
  if (zoom <= 1) return FULL_VIEW;
  const halfL = (pitch.length / 2 + MARGIN) * (1 - 1 / zoom);
  const halfW = (pitch.width / 2 + MARGIN) * (1 - 1 / zoom);
  return {
    cx: Math.max(-halfL, Math.min(halfL, ball.x)),
    cy: Math.max(-halfW, Math.min(halfW, ball.y)),
    zoom,
  };
}

/** Eases a camera toward a target so following the ball doesn't jitter (k = share moved per frame). */
export function easeCamera(from: Camera, to: Camera, k = 0.18): Camera {
  if (from.zoom !== to.zoom) return to;
  return { cx: from.cx + (to.cx - from.cx) * k, cy: from.cy + (to.cy - from.cy) * k, zoom: to.zoom };
}

/** Pixels per metre at zoom 1 for a canvas `cssW` wide. */
export const scaleFor = (pitch: PitchDims, cssW: number) => cssW / (pitch.length + 2 * MARGIN);

/** Screen point (CSS px) → pitch point (m), under the camera. */
export function toPitch(pitch: PitchDims, cssW: number, cssH: number, cam: Camera, px: number, py: number) {
  const s = scaleFor(pitch, cssW) * cam.zoom;
  return { x: cam.cx + (px - cssW / 2) / s, y: cam.cy + (py - cssH / 2) / s };
}

/** The player closest to a pitch point, if within `reach` metres. */
export function nearestPlayer(f: Frame, x: number, y: number, reach: number): Frame["players"][number] | null {
  let best: Frame["players"][number] | null = null;
  let d = reach;
  for (const p of f.players) {
    const pd = Math.hypot(p.x - x, p.y - y);
    if (pd <= d) {
      d = pd;
      best = p;
    }
  }
  return best;
}

/** Sim player id ("blue-3") → slot index in the team's starting lineup (2), or null. */
export function slotOf(simId: string): { side: "home" | "away"; index: number } | null {
  const m = /^(blue|red)-(\d+)$/.exec(simId);
  return m ? { side: m[1] === "blue" ? "home" : "away", index: Number(m[2]) - 1 } : null;
}

/** Smallest on-screen player radius (px): below about 12 px across, a side's shape stops reading. */
export const MIN_PLAYER_R = 6;
/** Shirt numbers are drawn once a player is at least this big on screen (px radius). */
export const NUMBER_MIN_R = 7.5;

/**
 * On-screen sizes (CSS px) of players and ball for a canvas `cssW` wide at a zoom. Players are
 * drawn a bit larger than their simulated radius, and more so on bigger pitches (which are drawn
 * smaller), with a floor so they stay visible on phones. Display only.
 */
export function sprites(pitch: PitchDims, playerRadius: number, cssW: number, zoom = 1) {
  const s = scaleFor(pitch, cssW);
  const grow = Math.max(1, pitch.length / 50);
  const player = Math.max(MIN_PLAYER_R, playerRadius * s * 1.35 * grow * zoom);
  const ball = Math.max(4, 0.26 * s * grow * zoom);
  return { player, ball, numbers: player >= NUMBER_MIN_R };
}
