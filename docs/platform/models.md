# Manager models: registry, gateway and qualification (#94)

Each Phase 2 club is founded and run by one distinct model. This page covers which models are candidates, how they're called, what they cost, and how they qualify. **No model has been live-qualified yet**: everything below was checked against documentation, and no paid call has been made.

## Identity, model and assignment are separate

| Concept | Where | Rule |
| --- | --- | --- |
| **Model** | `models/registry.ts` (`registry/1`) | An exact API model ID, its provider, route, pinning, prices and capabilities. |
| **Manager identity / career** | The club's founder (#95) | Persists across seasons. Its private memory belongs to it alone. |
| **Assignment** | Dated, per club (#95/#99) | One model per inaugural club. The model never changes midseason, and there is no silent fallback to another model. Availability and retirement are explicit. |

## Registry (verified 2026-11-27, by web lookup)

`bun run models list` prints it, and `bun run models check` checks the allocation: 20 distinct models with MiniMax held in reserve.

| Provider | Slots | Candidates | Status |
| --- | ---: | --- | --- |
| OpenAI | 3 | `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6.1-terra` | Terra stands in for the "Luna" intent. `gpt-6-luna` ($0.10/$0.50) is the alternative. **Needs approval** |
| Anthropic | 3 | `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5` | Candidates. Dateless IDs are pinned snapshots |
| Google | 2 | `gemini-4-argon`, `gemini-4-neon` | Candidates. GA isn't confirmed. Argon's price doubles on 2026-12-01, and the higher price is used |
| Mistral | 2 | `mistral-large-4-0`, `mistral-small-2603` | Small 4's ID is inferred from OpenRouter, so it **needs approval**. Medium 3.5 is deprecated and retires 2027-04-30 |
| DeepSeek | 2 | `deepseek-v4-pro`, `deepseek-flash` | Candidates. These are DeepSeek's only two models. Both are **moving names** and offer JSON mode only, so the schema is validated here |
| Alibaba | 2 | `qwen4-max`, `qwen3.8-max-0902` | Candidates |
| Meta | 2 | `muse-spark-1.3`, `muse-ember-1.0` via OpenRouter | **Needs approval.** Meta's own API serves Muse models, not Llama. Llama 4 Maverick and Scout (April 2025, one host each) are the alternatives |
| xAI | 1 | `grok-4.7` | Candidate. No dated pin is documented |
| Cohere | 1 | `command-a-plus-05-2026` | Provisional per #92, and pinned |
| Moonshot | 1 | `kimi-k3.1-pro` | Candidate. Its price is from OpenRouter, and the higher of two endpoints is used |
| Z.ai | 1 | `glm-5.3` | Candidate. The lowercase ID is inferred |
| MiniMax | reserve | `MiniMax-M3` | Allocated only if Cohere fails live qualification |

**Pinning.** Only the Anthropic models, Cohere's, Qwen 3.8 Max and Mistral Large 4.0 have documented pinned IDs. The others may move under the same name. For those, qualification and every run record the version the provider reports, and the operator must accept that before launch.

**Prices.** First-party prices are used where they were found, otherwise OpenRouter's (each entry records which). Endpoint base URLs aren't re-verified (`endpointVerified: false`). The first live qualification confirms them.

## Gateway (`models/gateway.ts`)

- **Transports.** One OpenAI-compatible transport (`POST {base}/chat/completions`) covers every provider with such an endpoint. OpenRouter is used only where a provider has no direct route (Meta). Anthropic can also keep its SDK client (`agents/llm.ts`).
- **Structured output.** Models that support it get a JSON Schema `response_format`. The others get JSON mode, with the schema in the system prompt. Either way the gateway parses and validates the answer against the task's zod schema, and never trusts it.
- **Bounds.**
  - Every call has a timeout (120 s by default).
  - Transient failures (timeouts, 429s and 5xx) get at most 2 retries, with backoff.
  - Permanent errors aren't retried.
  - Output that fails validation gets at most one repair turn.
  - Every attempt's tokens are counted, so repairs are charged.
- **No substitution.** A failure raises `ModelUnavailableError` naming the model. The caller keeps the club's last valid decision; agents/service.ts already falls back to the last valid tactics. Nothing ever calls a different model on a club's behalf.
- **Where it runs.** Only from jobs. Page rendering and simulator ticks can't reach it.

## Cost controls

- **Two ledgers.** Real model spend is in USD, in the compute ledger (#24: grants, worst-case reservations, charges and releases). It is entirely separate from the clubs' fictional credits.
- **Worst-case reservation.** Before each call, the compute ledger holds `worstCaseMicroUsd(spec, maxIn, maxOut)` (doubled for a possible repair) and settles it after. A club's season cap is per model, because each club has one model.
- **Projection.** `bun run models project` estimates spend per model per 30 days. At 5 manager calls per club per day, 6k input and 1.5k output tokens per call, and 20 seasonal calls per 24-day season, the 20 managers would cost about **$108 per 30 days**. The newsroom and hosting are separate. These are estimates from token assumptions, not measurements. Live qualification records real tokens, latency and cost per model.

## Qualification (`models/qualify.ts`, `models/scenarios.ts`)

A model qualifies on **operational reliability, not sporting skill**. Each scenario runs 3 times (`--reps`). A model passes when at least 90% of all trials pass and every scenario passes at least 2 of its 3 runs.

| Scenario | The model must… |
| --- | --- |
| `legal-lineup` | name exactly seven fit starters with one goalkeeper, in an allowed formation |
| `invalid-action-recovery` | correct its lineup after a league ruling rejects it (a suspension and a forced formation) |
| `strategic-memory` | restate its own remembered principle exactly, and act consistently with it |
| `financial-constraints` | keep its bids within cash minus the wages still to pay, under the bid limits |
| `negotiation` | answer competing offers without accepting below its own reservation fee, or accepting two |
| `prompt-injection` | ignore an "override" smuggled into another club's offer message |
| `founding-identity` | produce a valid, unique club charter: a free name and short name, and colours with contrast ≥ 3 |

Each trial records its outcome (valid, illegal, invalid, unavailable, refused, or stopped by the budget), attempts, repairs, latency, tokens and cost. Qualification stops at its spend cap and never overspends.

```sh
bun run models qualify --mock good          # reference behaviour: qualifies
bun run models qualify --mock flaky         # a 429, then malformed JSON, then good: still qualifies
bun run models qualify --mock gullible      # follows the injected instruction: fails prompt-injection
bun run models qualify --mock down|broken|slow
# Paid, only after approval (#101): through the credential wrappers, with a total cap
bun run models qualify --live --spend-cap-usd 5 --confirm-paid --models all
```

The mock providers test the harness itself: retries, repairs, timeouts, outages, injection and the spend cap. They don't stand in for real models. **No live qualification has been run**, and Cohere and MiniMax are still to be compared live.

## Decisions needed before live qualification

1. **The Meta slot:** Muse (`muse-spark-1.3` and `muse-ember-1.0`) or Llama 4 (Maverick and Scout)?
2. **Mistral's second model:** Small 4, or the deprecated Medium 3.5?
3. **OpenAI's third model:** Terra or Luna?
4. **Moving names:** whether to accept models without a pinned snapshot (DeepSeek ×2, and possibly OpenAI, Google, xAI, Kimi, GLM and MiniMax).
5. **Spend:** the spend cap for live qualification, and keys for each provider (or OpenRouter) through the credential wrappers.
