# Spend forecast and caps for the 20-model league (#101, gate 7)

These are measured costs, not token assumptions: the live pilot's answered calls while every provider was answering ([pilot](pilot-2026-11-28.md)). There are about 11 calls per model, so read them as ±50%.

## Managers

Per club per season, on calendar/1: 38 pre-match and 38 post-match decisions, plus preseason renewals and two free-agency steps.

| Model | Per season | Route |
| --- | ---: | --- |
| `google/gemini-4-neon` | $7.48 | OpenRouter |
| `anthropic/claude-fable-5-2` | $4.86 | direct |
| `alibaba/qwen3.8-max` | $3.84 | OpenRouter |
| `zai/glm-5.3` | $2.95 | OpenRouter |
| `openai/gpt-6.2-astra` | $2.76 | direct |
| `xai/grok-4.7` | $2.71 | OpenRouter |
| `anthropic/claude-opus-5-5` | $2.68 | direct |
| `deepseek/deepseek-v4-pro` | $2.29 | OpenRouter |
| `moonshot/kimi-k3.1-pro` | $2.05 | OpenRouter |
| `google/gemini-4-argon` | $1.77 | OpenRouter |
| `alibaba/qwen4-max` | $1.27 | OpenRouter |
| `anthropic/claude-sonnet-5-5` | $1.09 | direct |
| `mistral/mistral-large-4-0` | $1.06 | OpenRouter |
| `meta/muse-spark-1.3` | $1.05 | OpenRouter |
| `openai/gpt-6.2-sol` | $0.68 | direct |
| `openai/gpt-6.1-terra` | $0.35 | direct |
| `cohere/command-a-plus` | $0.32 | OpenRouter |
| `deepseek/deepseek-flash` | $0.27 | OpenRouter |
| `meta/muse-ember-1.0` | $0.15 | OpenRouter |
| `mistral/mistral-small-4` | $0.05 | OpenRouter |
| **League** | **$39.70 a season**, of which OpenRouter $27.27 | |

A season takes about 23 days, so this is **about $52 per 30 days**, or **$1.19 a day through OpenRouter**. The models that ran out of answer room (Gemini Neon, Qwen 3.8 Max, GLM, DeepSeek V4 Pro) will cost more now that they have room to finish; allow up to about 1.5× for them. The earlier projection from token assumptions was $101 per 30 days ([models.md](../platform/models.md)).

## Caps, in configuration

`LAUNCH_CAPS` in `founding/inaugural.ts` holds the defaults for `bun run leagues inaugural`, and the league stores them in its settings.

| Cap | Value | Effect |
| --- | --- | --- |
| Managers, per club per season | **$10** | Covers the dearest model with headroom. Every call reserves its worst case first, so this is a hard ceiling. |
| League, managers | 20 × $10 = **at most $200 a season** (about $260 per 30 days) | The worst case if every club spent its whole budget. The expected spend is about $52 per 30 days. |
| Newsroom, per season | **$25** (about 340 pieces at the measured ~$0.07 each) | Past it, the offline template writer covers the rest at no cost. |
| OpenRouter account, daily | **$10, enough:** about 8× the forecast $1.19 a day. Don't lower it below about $5 | If a day's spend reaches it, the 14 OpenRouter clubs are refused until it resets. They keep their last decisions, and matches still play. |

The command refuses a $0 manager budget, which would skip every decision.

## Newsroom

In production today, 12-fixture seasons cost about $2.30 for about 30 articles. A 380-fixture season at the same rate would cost about $70, so the $25 cap (about $33 per 30 days) binds. Expect model-written coverage of the biggest stories and template coverage of the rest.

## Hosting

The 20-model league runs on the existing exe.dev VM and Cloudflare setup, with no new services. Database growth is small: the nightly dump is 3.3 MB today. The VM's disk is now kept at two image tags by `deploy.sh` (#126).

## Monthly total, expected (worst case)

| Item | Per 30 days |
| --- | ---: |
| Managers | about $52, up to about $70 with more answer room ($260 ceiling) |
| Newsroom | up to about $33 (the cap) |
| Hosting | unchanged |
| **Total model spend** | **about $85–105** ($293 ceiling) |
