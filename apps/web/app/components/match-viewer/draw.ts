import type { Frame } from "./replay-adapter";

export interface DrawOptions {
  pitch: {
    length: number;
    width: number;
    goalWidth: number;
    goalDepth: number;
    penaltyAreaDepth: number;
    penaltyAreaWidth: number;
    centreCircleRadius: number;
  };
  playerRadius: number;
  colors: { home: string; away: string; homeText: string; awayText: string };
}

const MARGIN = 2.5; // metres of run-off drawn around the pitch

/** Pitch aspect (incl. run-off) for responsive sizing. */
export const aspect = (p: DrawOptions["pitch"]) => (p.length + 2 * MARGIN) / (p.width + 2 * MARGIN);

/** Top-down 2D render matching the simulator's own viewer: circles on a striped pitch. */
export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame, o: DrawOptions, cssW: number, cssH: number) {
  const { pitch } = o;
  const s = cssW / (pitch.length + 2 * MARGIN);
  const X = (x: number) => (x + pitch.length / 2 + MARGIN) * s;
  const Y = (y: number) => (y + pitch.width / 2 + MARGIN) * s;
  ctx.clearRect(0, 0, cssW, cssH);
  // run-off and stripes
  ctx.fillStyle = "#2f7d33";
  ctx.fillRect(0, 0, cssW, cssH);
  for (let i = 0; i < pitch.length / 5; i++) {
    ctx.fillStyle = i % 2 ? "#3f9a3f" : "#3a9139";
    ctx.fillRect(X(-pitch.length / 2 + i * 5), Y(-pitch.width / 2), 5 * s, pitch.width * s);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(2, s * 0.16);
  ctx.strokeRect(X(-pitch.length / 2), Y(-pitch.width / 2), pitch.length * s, pitch.width * s);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(-pitch.width / 2));
  ctx.lineTo(X(0), Y(pitch.width / 2));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(0), Y(0), pitch.centreCircleRadius * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(0), Y(0), Math.max(1.5, s * 0.18), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  // corner arcs
  const cr = Math.max(4, s * 1);
  for (const [cx, cy, a0] of [
    [-1, -1, 0],
    [1, -1, Math.PI / 2],
    [1, 1, Math.PI],
    [-1, 1, (3 * Math.PI) / 2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(X((cx * pitch.length) / 2), Y((cy * pitch.width) / 2), cr, a0, a0 + Math.PI / 2);
    ctx.stroke();
  }
  for (const side of [-1, 1]) {
    const gx = (side * pitch.length) / 2;
    const bx = side < 0 ? gx : gx - pitch.penaltyAreaDepth;
    ctx.strokeRect(X(bx), Y(-pitch.penaltyAreaWidth / 2), pitch.penaltyAreaDepth * s, pitch.penaltyAreaWidth * s);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    const gx0 = side < 0 ? gx - pitch.goalDepth : gx;
    ctx.fillRect(X(gx0), Y(-pitch.goalWidth / 2), pitch.goalDepth * s, pitch.goalWidth * s);
    // net hatching
    ctx.save();
    ctx.beginPath();
    ctx.rect(X(gx0), Y(-pitch.goalWidth / 2), pitch.goalDepth * s, pitch.goalWidth * s);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    const step = Math.max(3, s * 0.3);
    for (let d = -pitch.goalWidth * s; d < pitch.goalWidth * s + pitch.goalDepth * s; d += step) {
      ctx.beginPath();
      ctx.moveTo(X(gx0) + d, Y(-pitch.goalWidth / 2));
      ctx.lineTo(X(gx0) + d - pitch.goalWidth * s, Y(pitch.goalWidth / 2));
      ctx.moveTo(X(gx0) + d - pitch.goalWidth * s, Y(-pitch.goalWidth / 2));
      ctx.lineTo(X(gx0) + d, Y(pitch.goalWidth / 2));
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(2, s * 0.16);
    ctx.strokeRect(X(gx0), Y(-pitch.goalWidth / 2), pitch.goalDepth * s, pitch.goalWidth * s);
  }
  // players
  const r = Math.max(5, o.playerRadius * s * 1.15);
  for (const p of f.players) {
    ctx.globalAlpha = p.stunned ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), r, 0, Math.PI * 2);
    ctx.fillStyle = p.side === "home" ? o.colors.home : o.colors.away;
    ctx.fill();
    ctx.lineWidth = p.gk ? 3 : 1.5;
    ctx.strokeStyle = p.gk ? "#f2c94c" : "#ffffff";
    ctx.stroke();
    // heading tick
    ctx.beginPath();
    ctx.moveTo(X(p.x) + Math.cos(p.heading) * r * 0.55, Y(p.y) + Math.sin(p.heading) * r * 0.55);
    ctx.lineTo(X(p.x) + Math.cos(p.heading) * r * 1.25, Y(p.y) + Math.sin(p.heading) * r * 1.25);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (r >= 8) {
      ctx.fillStyle = p.side === "home" ? o.colors.homeText : o.colors.awayText;
      ctx.font = `700 ${Math.round(r * 1.05)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(p.number), X(p.x), Y(p.y) + 0.5);
    }
  }
  // ball: white with a dark centre panel, like a classic match ball
  const br = Math.max(4, 0.26 * s);
  const bx = X(f.ball.x);
  const by = Y(f.ball.y);
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#20203b";
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const px = bx + Math.cos(a) * br * 0.42;
    const py = by + Math.sin(a) * br * 0.42;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#20203b";
  ctx.fill();
}
