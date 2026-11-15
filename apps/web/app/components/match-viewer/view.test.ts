import { describe, expect, it } from "vitest";
import type { Frame } from "./replay-adapter";
import {
  CLASH,
  colourDistance,
  FULL_VIEW,
  followCamera,
  kitColours,
  MARGIN,
  nearestPlayer,
  PITCH_CLASH,
  PITCH_GREEN,
  scaleFor,
  slotOf,
  toPitch,
} from "./view";

const pitch = { length: 60, width: 38 };

describe("replay view maths", () => {
  it("keeps kits apart: a clashing away kit switches to its secondary, else white or ink", () => {
    expect(
      kitColours({ primary: "#245EFF", secondary: "#FFFFFF" }, { primary: "#FF654F", secondary: "#20203B" }),
    ).toEqual({
      home: "#245EFF",
      away: "#FF654F",
      changed: false,
    });
    const clash = kitColours(
      { primary: "#E03A2A", secondary: "#FFFFFF" },
      { primary: "#E2452F", secondary: "#1B2A6B" },
    );
    expect(clash).toEqual({ home: "#E03A2A", away: "#1B2A6B", changed: true });
    expect(colourDistance(clash.home, clash.away)).toBeGreaterThanOrEqual(CLASH);
    // A green kit melts into the pitch: it wears its secondary.
    const green = kitColours(
      { primary: "#1F9D74", secondary: "#FFCB45" },
      { primary: "#245EFF", secondary: "#FFFFFF" },
    );
    expect(green).toEqual({ home: "#FFCB45", away: "#245EFF", changed: true });
    expect(colourDistance(green.home, PITCH_GREEN)).toBeGreaterThanOrEqual(PITCH_CLASH);
    // Secondary clashes too: fall back to white.
    expect(
      kitColours({ primary: "#E03A2A", secondary: "#FFFFFF" }, { primary: "#E2452F", secondary: "#DD3322" }).away,
    ).toBe("#FFFFFF");
  });

  it("follows the ball without leaving the pitch, and is the full view at zoom 1", () => {
    expect(followCamera(pitch, { x: 10, y: 5 }, 1)).toEqual(FULL_VIEW);
    expect(followCamera(pitch, { x: 10, y: 5 }, 2)).toEqual({ cx: 10, cy: 5, zoom: 2 });
    const corner = followCamera(pitch, { x: 30, y: 19 }, 2);
    expect(corner.cx).toBeCloseTo((30 + MARGIN) / 2);
    expect(corner.cy).toBeCloseTo((19 + MARGIN) / 2);
  });

  it("maps a tap back to the pitch under any camera, and finds the player there", () => {
    const w = 390;
    const h = w / ((pitch.length + 2 * MARGIN) / (pitch.width + 2 * MARGIN));
    expect(toPitch(pitch, w, h, FULL_VIEW, w / 2, h / 2)).toEqual({ x: 0, y: 0 });
    const cam = { cx: 10, cy: -4, zoom: 2 };
    const s = scaleFor(pitch, w) * 2;
    const at = toPitch(pitch, w, h, cam, w / 2 + 3 * s, h / 2 + 1 * s);
    expect(at.x).toBeCloseTo(13);
    expect(at.y).toBeCloseTo(-3);
    const frame = {
      players: [
        { id: "blue-1", side: "home", number: 1, gk: true, x: -28, y: 0, heading: 0, stunned: false },
        { id: "red-7", side: "away", number: 7, gk: false, x: 12.5, y: -3.2, heading: 0, stunned: false },
      ],
    } as unknown as Frame;
    expect(nearestPlayer(frame, at.x, at.y, 2)?.id).toBe("red-7");
    expect(nearestPlayer(frame, 0, 15, 2)).toBeNull();
  });

  it("maps simulator ids to lineup slots", () => {
    expect(slotOf("blue-1")).toEqual({ side: "home", index: 0 });
    expect(slotOf("red-11")).toEqual({ side: "away", index: 10 });
    expect(slotOf("ref")).toBeNull();
  });
});
