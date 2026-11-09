import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Where replay files live. URIs are opaque to callers: `local://<key>` for the file store. */
export interface ReplayStore {
  put(key: string, bytes: Uint8Array): Promise<string>;
  get(uri: string): Promise<Uint8Array>;
}

export class FileReplayStore implements ReplayStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private pathOf(key: string) {
    if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes("..")) throw new Error(`invalid replay key: ${key}`);
    return join(this.root, key);
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
