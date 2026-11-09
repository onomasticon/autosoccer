import type { Context } from "hono";
import type { z } from "zod";

export const notFound = (c: Context, what: string) =>
  c.json({ error: { code: "not_found", message: `${what} not found` } }, 404);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/**
 * Returns a contract-checked JSON response. In tests and development the payload is
 * validated against the zod schema, so handlers can't drift from the published contract.
 */
export function contractJson<T extends z.ZodType>(c: Context, schema: T, body: z.infer<T>) {
  if (process.env.NODE_ENV !== "production") {
    const r = schema.safeParse(body);
    if (!r.success) throw new Error(`response violates contract: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
  }
  return c.json(body as object);
}
