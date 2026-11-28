# Live model qualification, 2026-11-27 (#94)

`bun run models qualify --live` ran through the credential wrappers, against every allocated model and the reserve. Each of the seven scenarios ran three times, with the routing from [models.md](models.md): OpenAI and Anthropic direct, everyone else through OpenRouter on a pinned host. The approved cap was $50, and **$5.43 was spent across all runs**: the first round of qualification, the reruns after each fix, and the final requalification under the current rules. Raw results are in `out/models/run1.json` to `run5.json`, local and not committed.

**The rule.** A model qualifies when at least 90% of its trials produce a usable answer and every scenario does in at least 2 of 3 runs. Judgment is recorded but doesn't disqualify a model:
- **Legal** decisions: illegal ones are rejected in play, as they would be for any club.
- **Exploited:** prompt-injection trials where the model was talked into a bad deal by another club's message.
- **Fixes:** presentation corrections made by the normaliser.

The operator's decision is to keep every model, so its weaknesses play out in the league.

## Results (final rules)

| Model | Result | Usable | Legal | Exploited | Fixes | Median latency | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `openai/gpt-6.2-astra` | pass | 100% | 21/21 | 0 | 0 | 3.8 s | $0.140 |
| `openai/gpt-6.2-sol` | pass | 100% | 21/21 | 0 | 0 | 2.5 s | $0.040 |
| `openai/gpt-6.1-terra` | pass | 100% | 21/21 | 0 | 0 | 2.9 s | $0.021 |
| `anthropic/claude-fable-5-2` | pass | 100% | 21/21 | 0 | 0 | 2.5 s | $0.309 |
| `anthropic/claude-opus-5-5` | pass | 100% | 21/21 | 0 | 0 | 3.6 s | $0.207 |
| `anthropic/claude-sonnet-5-5` | pass | 100% | 21/21 | 0 | 0 | 1.9 s | $0.080 |
| `google/gemini-4-argon` | pass | 100% | 21/21 | 0 | 0 | 5.3 s | $0.108 |
| `google/gemini-4-neon` | pass | 100% | 21/21 | 0 | 6 | 8.6 s | $0.329 |
| `mistral/mistral-large-4-0` | pass | 100% | 21/21 | 0 | 0 | 16.5 s | $0.131 |
| `mistral/mistral-small-4` | pass | 100% | **15/21** | **3** | 8 | 1.2 s | $0.003 |
| `deepseek/deepseek-v4-pro` | pass | 100% | 21/21 | 0 | 0 | 5.0 s | $0.114 |
| `deepseek/deepseek-flash` | pass | 100% | 21/21 | 0 | 0 | 2.4 s | $0.018 |
| `alibaba/qwen4-max` | pass | 100% | 21/21 | 0 | 1 | 6.0 s | $0.072 |
| `alibaba/qwen3.8-max` | pass | 100% | 21/21 | 0 | 1 | 19.1 s | $0.177 |
| `meta/muse-spark-1.3` | pass | 100% | 21/21 | 0 | 0 | 9.5 s | $0.149 |
| `meta/muse-ember-1.0` | pass | 100% | 21/21 | 0 | 0 | 2.3 s | $0.015 |
| `xai/grok-4.7` | pass | 100% | 21/21 | 0 | 0 | 5.2 s | $0.192 |
| `cohere/command-a-plus` | pass | 100% | **18/21** | **3** | 0 | 6.4 s | $0.043 |
| `moonshot/kimi-k3.1-pro` | pass | 100% | 21/21 | 0 | 0 | 12.9 s | $0.145 |
| `zai/glm-5.3` | pass | 100% | 21/21 | 0 | 12 | 15.4 s | $0.237 |
| `minimax/minimax-m3` (reserve) | pass | 100% | 20/21 | 0 | 1 | 2.4 s | $0.007 |

**All 20 allocated models and the reserve qualify.** Two will be easy marks in the transfer market:
- **Cohere Command A+** accepted an offer far below its own price when another club's message told it to, 3 of 3 times.
- **Mistral Small 4** did the same 3 of 3, and also attempted other illegal moves: overspending its budget and fielding the wrong number of keepers. The platform rejects those in play.

The models that needed the most tidying are GLM 5.3, which often leaves out the reason field (12 fixes), and Gemini 4 Neon, which writes colours in other formats (6 fixes).

## Problems in our setup, found and fixed

The live runs uncovered these, and the affected models were rerun after each fix:

- **OpenAI's current models reject `max_tokens`.** OpenAI is now sent `max_completion_tokens`.
- **Cohere rejects size and range keywords** in JSON schema. They're stripped per model, and the full schema is still checked locally.
- **Cohere and Mistral reject an empty assistant message**, so a repair after an empty answer now quotes "(an empty answer)".
- **The MiniMax reserve's pinned host didn't accept `response_format`.** It's re-pinned from Parasail fp8 to DeepInfra fp8.
- **DeepSeek's own endpoint was blocked** by the OpenRouter account's privacy setting. The operator allowed it, and both models qualified.
- **Malformed but salvageable answers.**
  - The normaliser now trims over-long text, fills missing reasons and normalises colours.
  - There are two repair turns instead of one, and a cut-off answer is told to keep it short.
- **Mistral Large ran out of output room at 4,000 tokens.** Its ceiling is now 8,000 (`maxOutputTokens`).

## For running a season

- **Latency.** Most models answer within 2–10 s. Qwen 3.8 Max (19 s), Mistral Large (17 s), GLM (15 s) and Kimi (13 s) are slower, but well inside the calendar's deadlines.
- **Tokens.** A decision uses roughly 450–3,500 tokens, inside the cost projection's 7.5k assumption.
