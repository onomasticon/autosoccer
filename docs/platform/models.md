# Manager models: registry, gateway and qualification (#94)

Each Phase 2 club is founded and run by one distinct model. This page covers which models are candidates, how they're called, what they cost, and how they qualify. **No model has been live-qualified yet**: everything below was checked against documentation, and no paid call has been made.

## Identity, model and assignment are separate

| Concept | Where | Rule |
| --- | --- | --- |
| **Model** | `models/registry.ts` (`registry/1`) | An exact API model ID, its provider, route, pinning, prices and capabilities. |
| **Manager identity / career** | The club's founder (#95) | Persists across seasons. Its private memory belongs to it alone. |
| **Assignment** | Dated, per club (#95/#99) | One model per inaugural club. The model never changes midseason, and there is no silent fallback to another model. Availability and retirement are explicit. |

## Registry (verified 2026-11-27, by web lookup)

`bun run models list` prints it, and `bun run models check` checks the allocation (20 distinct models, MiniMax held in reserve) and the routing.

## Routing

- **OpenAI and Anthropic go direct.** OpenAI is called over its own API (OpenAI-compatible transport). Anthropic is called through its SDK, the client production already uses.
- **Everything else goes through OpenRouter, each model pinned to one host.** The gateway sends `provider: { order: [host], allow_fallbacks: false }`, so OpenRouter won't move a model to another host. If an answer comes back from any host other than the pinned one, the gateway refuses it and the club keeps its last valid decision. One key, `OPENROUTER_API_KEY`, covers all of them.
- **Hosts.** The lab's own endpoint wherever OpenRouter offers one, on its standard tier (not flex or priority), checked against OpenRouter's endpoint list on 2026-11-27. Several open-weight models are also served by cheaper third-party hosts at reduced precision (fp4/fp8). Pinning to the lab's endpoint keeps every call on the weights the lab serves.

| Provider | Slots | Model (OpenRouter ID) | Pinned host | Notes |
| --- | ---: | --- | --- | --- |
| OpenAI | 3 | `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6.1-terra` | direct | Terra chosen over Luna |
| Anthropic | 3 | `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5` | direct (SDK) | Dateless IDs are pinned snapshots |
| Google | 2 | `google/gemini-4-argon`, `google/gemini-4-neon` | Google AI Studio | GA isn't confirmed. Argon's price doubles on 2026-12-01, and the higher price is used |
| Mistral | 2 | `mistralai/mistral-large-4-0`, `mistralai/mistral-small-2603` | Mistral (`mistral/zdr`) | Small 4 chosen; Medium 3.5 is deprecated |
| DeepSeek | 2 | `deepseek/deepseek-v4-pro-0813`, `deepseek/deepseek-v4.1-flash-1017` | DeepSeek | DeepSeek's own endpoint has no JSON-schema mode on OpenRouter, so these run in JSON mode and are validated here. The OpenRouter IDs are dated, which pins versions that DeepSeek's own API doesn't. Peak prices are used |
| Alibaba | 2 | `qwen/qwen4-max`, `qwen/qwen3.8-max-0902` | Alibaba | |
| Meta | 2 | `meta/muse-spark-1.3`, `meta/muse-ember` | Meta | Muse chosen over Llama 4. Ember costs $0.10/$0.50 |
| xAI | 1 | `x-ai/grok-4.7` | xAI | No dated pin is documented |
| Cohere | 1 | `cohere/command-a-plus` | Cohere (`cohere/fp8`, its only endpoint) | Provisional per #92 |
| Moonshot | 1 | `moonshotai/kimi-k3.1-pro` | Moonshot AI (`moonshotai/mxfp4`, standard tier) | |
| Z.ai | 1 | `z-ai/glm-5.3` | Z.AI (`z-ai/fp8`) | |
| MiniMax | reserve | `minimax/minimax-m3` | Parasail (`parasail/fp8`) | **No first-party MiniMax endpoint on OpenRouter.** The reserve would run on a third-party host in JSON mode. Needs approval if it's ever used |

**Pinning versions.** Only the Anthropic models, Cohere's, Qwen 3.8 Max, Mistral Large 4.0 and the dated DeepSeek IDs pin a version. The others may move under the same name. For those, qualification and every run record what was served, and the operator has accepted that (see Decisions).

**Prices.** Each entry records whether its price is first-party or OpenRouter's, at the pinned host. OpenRouter charges a fee on credit purchases, and the spend forecast must add it.

## League functions use Anthropic only

The newsroom (match reports, previews and league news) and any future league-side service run on Anthropic, called direct. `EDITORIAL_MODEL` is validated as a Claude model, and the server refuses to start with anything else. Only the clubs' managers use other providers. Without an Anthropic key, the free offline template writer takes over the newsroom.

## Gateway (`models/gateway.ts`)

- **Clients.** `llmForModel(spec)` returns the right client for a model: the Anthropic SDK, OpenAI's API, or OpenRouter with the pinned host. A missing key is an error, never a silent switch.
- **Structured output.** Models that support it get a JSON Schema `response_format`. The others get JSON mode, with the schema in the system prompt. Either way the gateway parses and validates the answer against the task's zod schema, and never trusts it.
- **Bounds.**
  - Every call has a timeout (120 s by default).
  - Transient failures (timeouts, 429s and 5xx) get at most 2 retries, with backoff.
  - Permanent errors aren't retried.
  - Output that fails validation gets at most one repair turn.
  - Every attempt's tokens are counted, so repairs are charged.
- **No substitution.** A failure raises `ModelUnavailableError` naming the model. The caller keeps the club's last valid decision; agents/service.ts already falls back to the last valid tactics. Nothing ever calls a different model, or a different host, on a club's behalf.
- **Shared dependency.** An OpenRouter outage makes 14 clubs' managers unavailable at once. The rules handle it (every club keeps its last valid decision), and the harness's `provider-downtime` scenario exercises it.
- **Where it runs.** Only from jobs. Page rendering and simulator ticks can't reach it.

## Cost controls

- **Two ledgers.** Real model spend is in USD, in the compute ledger (#24: grants, worst-case reservations, charges and releases). It is entirely separate from the clubs' fictional credits.
- **Worst-case reservation.** Before each call, the compute ledger holds `worstCaseMicroUsd(spec, maxIn, maxOut)` (doubled for a possible repair) and settles it after. A club's season cap is per model, because each club has one model.
- **Projection.** `bun run models project` estimates spend per model per 30 days. At 5 manager calls per club per day, 6k input and 1.5k output tokens per call, and 20 seasonal calls per 24-day season, the 20 managers would cost about **$101 per 30 days**. The newsroom and hosting are separate. These are estimates from token assumptions, not measurements. Live qualification records real tokens, latency and cost per model.

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
with-anthropic-token with-openai-token with-openrouter-token \
  bun run models qualify --live --spend-cap-usd 5 --confirm-paid --models all
```

The mock providers test the harness itself: retries, repairs, timeouts, outages, injection and the spend cap. They don't stand in for real models. **No live qualification has been run**, and Cohere and MiniMax are still to be compared live.

## Decisions

Made by the operator on 2026-11-27:

- **Meta:** Muse (`muse-spark-1.3` and `muse-ember`), not Llama 4.
- **Mistral's second model:** Small 4, not the deprecated Medium 3.5.
- **OpenAI's third model:** Terra, not Luna.
- **Moving names are accepted.** Models without a pinned version may be upgraded by their provider. Every run records the model and host that served it, so an upgrade shows up in the record.

Still open before live qualification: a **spend cap**, and three keys through the credential wrappers (Anthropic, OpenAI and OpenRouter).
