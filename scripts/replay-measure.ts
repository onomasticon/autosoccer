/**
 * Replay readability and cost measurements (issue #68): for each replay file given, prints the
 * format, on-screen sizes of players and ball at phone and desktop widths (the renderer's own
 * formulas), decode time, seek cost and the highlights the index finds. Read-only research.
 *
 *   bun scripts/replay-measure.ts <replay.json.gz> [...]
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { OfficialEvent } from "@autosoccer/contracts";
import { buildHighlights } from "../apps/web/app/components/match-viewer/highlights.ts";
import { ReplaySource } from "../apps/web/app/components/match-viewer/replay-adapter.ts";
import { MARGIN, sprites } from "../apps/web/app/components/match-viewer/view.ts";

const WIDTHS = { phone: 390 - 2 * 16 - 2 * 12, desktop: 820 }; // canvas CSS width inside the page frame

for (const file of process.argv.slice(2)) {
  const t0 = performance.now();
  const json = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  const tParse = performance.now() - t0;
  const t1 = performance.now();
  const src = new ReplaySource(json);
  const tInit = performance.now() - t1;
  const size = src.frameAt(0).players.length / 2;
  const sizes = Object.fromEntries(
    Object.entries(WIDTHS).map(([k, w]) => {
      const full = sprites(src.pitch, src.playerRadius, w, 1);
      const zoomed = sprites(src.pitch, src.playerRadius, w, 2.5);
      return [
        k,
        {
          canvas: `${w}×${Math.round(w / ((src.pitch.length + 2 * MARGIN) / (src.pitch.width + 2 * MARGIN)))}`,
          playerDiameterPx: +(2 * full.player).toFixed(1),
          ballDiameterPx: +(2 * full.ball).toFixed(1),
          shirtNumbers: full.numbers,
          followZoom: { playerDiameterPx: +(2 * zoomed.player).toFixed(1), shirtNumbers: zoomed.numbers },
        },
      ];
    }),
  );
  // Crowding on a phone (full view): overlapping player circles, and the ball hidden under a
  // player that isn't carrying it, sampled once a second.
  const phone = sprites(src.pitch, src.playerRadius, WIDTHS.phone, 1);
  const pxPerM = WIDTHS.phone / (src.pitch.length + 2 * MARGIN);
  let samples = 0;
  let overlaps = 0;
  let hidden = 0;
  for (let t = 0; t <= src.finalTick; t += src.tickRate) {
    const f = src.frameAt(t);
    samples++;
    const ps = f.players;
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++)
        if (Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.y - ps[j]!.y) * pxPerM < 2 * phone.player) overlaps++;
    if (ps.some((p) => p.id !== f.carrier && Math.hypot(p.x - f.ball.x, p.y - f.ball.y) * pxPerM < phone.player))
      hidden++;
  }
  // Seek cost: sequential playback (next tick) vs random jumps.
  const seq = performance.now();
  for (let t = 0; t < 600; t++) src.frameAt(t);
  const tSeq = (performance.now() - seq) / 600;
  const ticks = Array.from({ length: 40 }, (_, i) => Math.floor((((i * 7919) % 40) / 40) * src.finalTick));
  const rnd = performance.now();
  for (const t of ticks) src.frameAt(t);
  const tRnd = (performance.now() - rnd) / ticks.length;
  // Official events aren't in the replay file: rebuild goals from the replay's own log for the index.
  const goals: OfficialEvent[] = src.events
    .filter((e) => e.event.type === "goalScored")
    .map(
      (e) =>
        ({
          type: "goal",
          tick: e.tick,
          period: "firstHalf",
          clockSec: 0,
          side: (e.event as { team: string }).team === "blue" ? "home" : "away",
          scorerId: null,
          ownGoal: false,
          score: { home: 0, away: 0 },
        }) as OfficialEvent,
    );
  const h = buildHighlights(goals, { finalTick: src.finalTick, tickRate: src.tickRate, events: src.events });
  console.log(
    JSON.stringify({
      file: file.split("/").slice(-2).join("/"),
      playersPerSide: size,
      pitch: `${src.pitch.length}×${src.pitch.width} m`,
      bytesGz: readFileSync(file).byteLength,
      ticks: src.finalTick,
      sizes,
      phoneCrowding: {
        overlappingPairsPerSecond: +(overlaps / samples).toFixed(2),
        ballHiddenShare: +(hidden / samples).toFixed(3),
      },
      ms: {
        parse: +tParse.toFixed(1),
        init: +tInit.toFixed(1),
        perSequentialFrame: +tSeq.toFixed(3),
        perRandomSeek: +tRnd.toFixed(2),
      },
      highlights: {
        goals: h.moments.filter((m) => m.kind === "goal").length,
        catches: h.moments.filter((m) => m.kind === "catch").length,
        reelSeconds: Math.round(h.reel.reduce((s, w) => s + w.end - w.start, 0) / src.tickRate),
      },
    }),
  );
}
