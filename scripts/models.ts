/**
 * The manager model registry and qualification CLI (#94).
 *
 *   bun run models list                       # the registry: allocation, status, pinning, prices, notes
 *   bun run models check                      # allocation and distinctness problems (exit 1 if any)
 *   bun run models project [--calls 5] [--in 6000] [--out 1500] [--seasonal 20] [--season-days 24]
 *   bun run models qualify --mock good|flaky|broken|down|gullible|slow [--models slug,…|all] [--reps 3]
 *   bun run models qualify --live --spend-cap-usd 5 --confirm-paid [--models slug,…] [--reps 3]
 *
 * Live qualification makes PAID calls to the providers. It refuses to run without --confirm-paid,
 * an explicit --spend-cap-usd (split evenly across the models), and each provider's key in the
 * environment (run it through the credential wrappers). Results go to out/models/qualification.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openAiCompatible } from "../apps/server/src/modules/models/gateway.ts";
import { type MockKind, mockTransport, qualify } from "../apps/server/src/modules/models/qualify.ts";
import { checkRegistry, PROVIDERS, projectSpend, REGISTRY } from "../apps/server/src/modules/models/registry.ts";

const [cmd = "list"] = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const has = (n: string) => process.argv.includes(`--${n}`);
const arg = (n: string, d: string) => (has(n) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d);
const pick = () => {
  const m = arg("models", "all");
  return m === "all" ? REGISTRY : REGISTRY.filter((x) => m.split(",").includes(x.slug));
};

if (cmd === "list") {
  for (const m of REGISTRY)
    console.log(
      `${m.status.padEnd(14)} ${m.slug.padEnd(30)} ${m.apiModelId.padEnd(24)} ${m.route.padEnd(10)} pin:${m.pinning.padEnd(8)} ${m.structuredOutput.padEnd(11)} $${m.price.input}/$${m.price.output} (${m.price.source})${m.notes ? `  — ${m.notes}` : ""}`,
    );
} else if (cmd === "check") {
  const problems = checkRegistry();
  console.log(problems.length ? problems.join("\n") : "allocation met: 20 distinct models, reserve held back");
  process.exit(problems.length ? 1 : 0);
} else if (cmd === "project") {
  const c = {
    callsPerClubPerDay: Number(arg("calls", "5")),
    inputTokens: Number(arg("in", "6000")),
    outputTokens: Number(arg("out", "1500")),
    seasonalCalls: Number(arg("seasonal", "20")),
    seasonDays: Number(arg("season-days", "24")),
  };
  const rows = projectSpend(c);
  for (const r of rows)
    console.log(`${r.slug.padEnd(30)} ${String(r.callsPer30Days).padStart(5)} calls  $${r.usdPer30Days.toFixed(2)}`);
  console.log(
    `total managers: $${rows.reduce((s, r) => s + r.usdPer30Days, 0).toFixed(2)} per 30 days (newsroom and hosting not included)`,
  );
} else if (cmd === "qualify") {
  const models = pick();
  const live = has("live");
  if (live && (!has("confirm-paid") || !has("spend-cap-usd"))) {
    console.error("live qualification makes paid calls: pass --confirm-paid and --spend-cap-usd <total>");
    process.exit(2);
  }
  const cap = Math.round((Number(arg("spend-cap-usd", "1")) * 1e6) / Math.max(1, models.length));
  const results = [];
  for (const spec of models) {
    let transport: ReturnType<typeof mockTransport> | ReturnType<typeof openAiCompatible>;
    if (live) {
      const p = PROVIDERS[spec.route === "openrouter" ? "meta" : spec.provider];
      const key = process.env[p.keyEnv];
      if (!key) {
        console.error(`${spec.slug}: ${p.keyEnv} is not set; skipped`);
        continue;
      }
      transport = openAiCompatible({ baseUrl: p.baseUrl, apiKey: key });
    } else transport = mockTransport(arg("mock", "good") as MockKind);
    const q = await qualify(spec, transport, { reps: Number(arg("reps", "3")), spendCapMicroUsd: cap, live });
    results.push(q);
    console.log(
      `${q.qualified ? "PASS" : "FAIL"} ${spec.slug.padEnd(30)} ${(q.passRate * 100).toFixed(0)}%  $${(q.spentMicroUsd / 1e6).toFixed(4)}  ${live ? "live" : `mock:${arg("mock", "good")}`}${q.reasons.length ? `  ${q.reasons.join("; ")}` : ""}`,
    );
  }
  mkdirSync("out/models", { recursive: true });
  writeFileSync("out/models/qualification.json", JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.qualified) ? 0 : 1);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
