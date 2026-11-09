import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileReplayStore, R2ReplayStore } from "./replay-store.ts";

/** Minimal path-style S3 endpoint: PUT/GET objects, rejects unsigned requests. */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; headers: Record<string, string> }>();
  const seen: Array<{ method: string; url: string; auth: string; sha: string }> = [];
  const read = (req: IncomingMessage) =>
    new Promise<Buffer>((res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => res(Buffer.concat(parts)));
    });
  const server: Server = createServer(async (req, res) => {
    const auth = String(req.headers.authorization ?? "");
    seen.push({ method: req.method!, url: req.url!, auth, sha: String(req.headers["x-amz-content-sha256"] ?? "") });
    if (!auth.startsWith("AWS4-HMAC-SHA256 Credential=AKIDTEST/")) {
      res.writeHead(403).end("unsigned");
      return;
    }
    if (req.method === "PUT") {
      objects.set(req.url!, {
        body: await read(req),
        headers: {
          "content-type": String(req.headers["content-type"]),
          "cache-control": String(req.headers["cache-control"]),
        },
      });
      res.writeHead(200).end();
    } else if (req.method === "GET") {
      const o = objects.get(req.url!);
      if (!o) res.writeHead(404).end("NoSuchKey");
      else res.writeHead(200, { "content-type": o.headers["content-type"] }).end(o.body);
    } else res.writeHead(405).end();
  });
  return { server, objects, seen };
}

describe("R2ReplayStore", () => {
  const s3 = fakeS3();
  let endpoint = "";
  beforeAll(async () => {
    await new Promise<void>((r) => s3.server.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${(s3.server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((r) => s3.server.close(() => r())));
  const store = () =>
    new R2ReplayStore({ endpoint, bucket: "replays", accessKeyId: "AKIDTEST", secretAccessKey: "secret" });

  it("puts signed, immutable gzip objects path-style and reads them back by URI", async () => {
    const bytes = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
    const uri = await store().put("season-1/match-abc.json.gz", bytes);
    expect(uri).toBe("r2://replays/season-1/match-abc.json.gz");
    const obj = s3.objects.get("/replays/season-1/match-abc.json.gz")!;
    expect(obj.headers).toEqual({
      "content-type": "application/gzip",
      "cache-control": "public, max-age=31536000, immutable",
    });
    expect(s3.seen.at(-1)!.auth).toMatch(/Credential=AKIDTEST\/\d{8}\/auto\/s3\/aws4_request/);
    expect(s3.seen.at(-1)!.sha).toMatch(/^[0-9a-f]{64}$/);
    expect([...(await store().get(uri))]).toEqual([...bytes]);
  });

  it("rejects bad keys, foreign URIs, missing objects and failed writes", async () => {
    await expect(store().put("../escape", new Uint8Array([1]))).rejects.toThrow("invalid replay key");
    await expect(store().get("local://x.json.gz")).rejects.toThrow("unsupported replay uri");
    await expect(store().get("r2://other-bucket/x.json.gz")).rejects.toThrow("unsupported replay uri");
    await expect(store().get("r2://replays/nope.json.gz")).rejects.toThrow("missing replay");
    const bad = new R2ReplayStore({ endpoint, bucket: "replays", accessKeyId: "WRONG", secretAccessKey: "x" });
    await expect(bad.put("a.json.gz", new Uint8Array([1]))).rejects.toThrow("HTTP 403");
  });
});

describe("FileReplayStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "replays-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("round-trips by local:// URI and refuses path escapes", async () => {
    const s = new FileReplayStore(dir);
    const uri = await s.put("a/b.json.gz", new Uint8Array([7, 8]));
    expect(uri).toBe("local://a/b.json.gz");
    expect([...(await s.get(uri))]).toEqual([7, 8]);
    await expect(s.put("/etc/x", new Uint8Array([1]))).rejects.toThrow("invalid replay key");
  });
});
