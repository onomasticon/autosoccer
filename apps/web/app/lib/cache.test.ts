import { describe, expect, it } from "vitest";
import { NO_STORE, PAGE_CACHE, pageHeaders } from "./cache";

describe("page cache headers", () => {
  it("lets the edge keep pages for a minute but never caches error pages", () => {
    expect(PAGE_CACHE).toContain("s-maxage=60");
    expect(PAGE_CACHE).toContain("max-age=0");
    expect(pageHeaders({})).toEqual({ "Cache-Control": PAGE_CACHE });
    expect(pageHeaders({ errorHeaders: new Headers() })).toEqual({ "Cache-Control": NO_STORE });
  });
});
