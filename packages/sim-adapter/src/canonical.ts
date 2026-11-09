import { createHash } from "node:crypto";

/** JSON with object keys sorted recursively, so equal values always serialise identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
