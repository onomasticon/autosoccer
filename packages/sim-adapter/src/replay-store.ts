import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AwsClient } from "aws4fetch";

/**
 * Where replay files live. URIs are opaque to callers: `local://<key>` for the file store,
 * `r2://<bucket>/<key>` for object storage.
 */
export interface ReplayStore {
  put(key: string, bytes: Uint8Array): Promise<string>;
  get(uri: string): Promise<Uint8Array>;
}

function checkKey(key: string) {
  if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes("..") || key.startsWith("/"))
    throw new Error(`invalid replay key: ${key}`);
  return key;
}

export class FileReplayStore implements ReplayStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private pathOf(key: string) {
    return join(this.root, checkKey(key));
  }
  async put(key: string, bytes: Uint8Array) {
    const p = this.pathOf(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
    return `local://${key}`;
  }
  async get(uri: string) {
    if (!uri.startsWith("local://")) throw new Error(`unsupported replay uri: ${uri}`);
    return new Uint8Array(readFileSync(this.pathOf(uri.slice("local://".length))));
  }
}

export class MemoryReplayStore implements ReplayStore {
  readonly files = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    this.files.set(key, bytes);
    return `local://${key}`;
  }
  async get(uri: string) {
    const f = this.files.get(uri.slice("local://".length));
    if (!f) throw new Error(`missing replay ${uri}`);
    return f;
  }
}

export interface R2ReplayStoreOptions {
  /** S3 API endpoint, e.g. https://<account-id>.r2.cloudflarestorage.com (any S3-compatible endpoint works). */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "auto" for R2. */
  region?: string;
  /** Override fetch (tests). */
  fetch?: typeof fetch;
}

/**
 * Cloudflare R2 (S3-compatible API, path-style). Replays are immutable, so objects are written
 * once with a long-lived cache header and never updated.
 */
export class R2ReplayStore implements ReplayStore {
  readonly bucket: string;
  private readonly base: string;
  private readonly client: AwsClient;
  private readonly doFetch: typeof fetch;
  constructor(o: R2ReplayStoreOptions) {
    this.bucket = o.bucket;
    this.base = `${o.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(o.bucket)}`;
    this.client = new AwsClient({
      accessKeyId: o.accessKeyId,
      secretAccessKey: o.secretAccessKey,
      service: "s3",
      region: o.region ?? "auto",
    });
    this.doFetch = o.fetch ?? fetch;
  }
  private url(key: string) {
    return `${this.base}/${checkKey(key).split("/").map(encodeURIComponent).join("/")}`;
  }
  private async send(url: string, init: RequestInit) {
    const signed = await this.client.sign(url, init);
    return this.doFetch(signed);
  }
  async put(key: string, bytes: Uint8Array) {
    const res = await this.send(this.url(key), {
      method: "PUT",
      body: bytes as Uint8Array<ArrayBuffer>,
      headers: {
        // Signed payload hash: the store rejects a body corrupted in transit.
        "x-amz-content-sha256": createHash("sha256").update(bytes).digest("hex"),
        "content-type": "application/gzip",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
    if (!res.ok) throw new Error(`R2 put ${key} failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    return `r2://${this.bucket}/${key}`;
  }
  async get(uri: string) {
    const prefix = `r2://${this.bucket}/`;
    if (!uri.startsWith(prefix)) throw new Error(`unsupported replay uri for bucket ${this.bucket}: ${uri}`);
    const key = uri.slice(prefix.length);
    const res = await this.send(this.url(key), { method: "GET" });
    if (res.status === 404) throw new Error(`missing replay ${uri}`);
    if (!res.ok) throw new Error(`R2 get ${key} failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
