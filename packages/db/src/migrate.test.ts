import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listMigrations, migrate } from "./migrate.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe("migrations", () => {
  it("lists migration files in version order with checksums", () => {
    const list = listMigrations();
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((m) => m.version)).toEqual([...list.map((m) => m.version)].sort((a, b) => a - b));
    expect(list[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("applies every migration once and is idempotent on re-run", async () => {
    const applied = await t.db<{ name: string }[]>`select name from schema_migrations order by version`;
    expect(applied.map((r) => r.name)).toEqual(listMigrations().map((m) => m.name));
    const again = await migrate(t.db);
    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBe(applied.length);
    const [meta] = await t.db`select value from app_meta where key = 'platform'`;
    expect(meta?.value).toMatchObject({ name: "autosoccer" });
  });

  it("is safe under concurrent runners (advisory lock)", async () => {
    const results = await Promise.all([migrate(t.db), migrate(t.db), migrate(t.db)]);
    for (const r of results) expect(r.applied).toEqual([]);
  });

  it("rejects a modified migration that was already applied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(join(dir, "0001_baseline.sql"), "select 1; -- edited");
    await expect(migrate(t.db, dir)).rejects.toThrow(/checksum mismatch/);
  });
});
