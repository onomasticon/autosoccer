import { Slug } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { slugify } from "./service.ts";

describe("article slugs", () => {
  it("never end in a hyphen when the 60-character cut lands on one", () => {
    // Real Season 3 headline whose cut fell on a word break.
    const s = slugify("Novak double as Saltmarsh Athletic beat Harbour City 3–0 in round 6");
    expect(s.endsWith("-")).toBe(false);
    expect(Slug.safeParse(`${s}-1af976`).success).toBe(true);
    expect(slugify(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });
});
