import { z } from "zod";
import { ROUTES } from "./api.ts";
import { CONTRACTS_VERSION, ErrorEnvelope } from "./common.ts";

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "output", unrepresentable: "any" }) as Record<string, unknown>;

/** Builds the OpenAPI 3.1 document for the public v1 API from the zod contracts. */
export function buildOpenApi() {
  const components: Record<string, unknown> = { ErrorEnvelope: schema(ErrorEnvelope) };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    if (!r.contentType) components[r.responseName] = schema(r.response);
    const parameters = [
      ...Object.entries(r.params ?? {}).map(([name, s]) => ({ name, in: "path", required: true, schema: schema(s) })),
      ...Object.entries(r.query ?? {}).map(([name, s]) => ({ name, in: "query", required: false, schema: schema(s) })),
    ];
    paths[r.path] ??= {};
    paths[r.path]![r.method] = {
      operationId: r.operationId,
      summary: r.summary,
      ...(parameters.length ? { parameters } : {}),
      responses: {
        "200": {
          description: "OK",
          content: r.contentType
            ? { [r.contentType]: { schema: { type: "string", format: "binary" } } }
            : { "application/json": { schema: { $ref: `#/components/schemas/${r.responseName}` } } },
        },
        "404": {
          description: "Not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Auto Soccer public API", version: CONTRACTS_VERSION },
    servers: [{ url: "/api/v1" }],
    paths,
    components: { schemas: components },
  };
}
