import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.ts";

describe("createDb TLS options", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-ca-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("verifies the server certificate against a CA file when one is given", async () => {
    const ca = join(dir, "ca.crt");
    writeFileSync(ca, "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n");
    const db = createDb("postgres://u:p@db.example.com:25060/d?sslmode=verify-full", { max: 3, caFile: ca });
    expect(db.options.max).toBe(3);
    expect(db.options.ssl).toMatchObject({ rejectUnauthorized: true, ca: expect.stringContaining("TEST") });
    await db.end();
  });

  it("leaves TLS to the URL's sslmode otherwise", async () => {
    const db = createDb("postgres://u:p@db.example.com:25060/d?sslmode=require");
    expect(db.options.ssl).toBe("require");
    await db.end();
  });
});
