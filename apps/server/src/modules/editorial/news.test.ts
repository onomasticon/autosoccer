import { describe, expect, it } from "vitest";
import { BIG_FEE, NEWS_PRIORITY, transferPriority } from "./news.ts";

describe("transfer news priority", () => {
  it("a quiet window is minor, deals are news, a big signing leads the homepage, a record fee most of all", () => {
    expect(transferPriority([], 0)).toBe(45);
    expect(transferPriority([2_500_000, 2_900_000], 12_000_000)).toBe(NEWS_PRIORITY.transfers);
    // A big fee beats the homepage headline threshold (75) and outranks league changes.
    expect(transferPriority([BIG_FEE], 12_000_000)).toBe(85);
    expect(transferPriority([12_150_000], 3_000_000)).toBe(90);
    // The first big deal is a record too.
    expect(transferPriority([6_000_000], 0)).toBe(90);
    expect(transferPriority([12_150_000], 3_000_000)).toBeLessThan(NEWS_PRIORITY.champions);
  });
});
