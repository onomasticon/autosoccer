# Performance

Measured with `bun run bench --matches 3 --write`. Full 2 × 120 s matches, mean of 3 seeds.

## Reference machine

- CPU: Apple M2 Pro (10 cores)
- Memory: 32 GB
- OS: darwin 22.4.0
- Runtime: bun-1.2.19, single thread per match

## Throughput (target: at least 10× real time)

| Scenario | ms per match | × real time | ticks/s | Notes |
| --- | ---: | ---: | ---: | --- |
| engine only (no commands) | 33 | **7324×** | 446,706 | physics + match rules, restarts via fallback |
| safe vs safe (in-process) | 61 | **3911×** | 238,531 | built-in baseline controllers |
| playground script (in-process) | 53 | **4561×** | 278,222 | debug script driving both teams |
| blue-possession vs red-counter (sandboxed) | 2128 | **113×** | 6,879 | 2 QuickJS sandboxes, 10 Hz decisions each |
| dumb vs dumb (sandboxed) | 1209 | **199×** | 12,111 | sandbox overhead with trivial logic |
| replay verify (re-simulate + hashes) | 84 | **2843×** | 173,384 | all hashes matched |

Target ≥10× real time: **met in every scenario**.

## Where the time goes (sandboxed match)

| Cost | µs |
| --- | ---: |
| engine `step` (one 60 Hz tick) | 3.6 |
| build + serialise one observation (host) | 14.5 |
| sandbox round trip with an empty controller (parse obs, freeze, call, stringify) | 163 |
| blue-possession decision | 505 |
| red-counter decision | 382 |

A full match has 14,640 ticks and 2,400 decisions per team. The engine costs about 50 ms per match; almost all of the rest is controller decisions inside QuickJS.

**Bottlenecks and what was done (M7):**

1. **Parsing the observation in QuickJS.** `JSON.parse` is slow for long decimal numbers. SDK 1.2 rounds observation numbers to 4 decimals (0.1 mm), which roughly halves parse time.
2. **An extra sandbox call per update to drain logs.** The host now reads a pending-log counter first and only drains when something was logged.
3. **Controller helpers.** `Soccer.interceptPoint` now computes the ball-path constants once per call instead of once per step, and rejects unreachable points early.
4. **Batches scale across cores.** `bun run tournament` runs matches in parallel worker processes, and each match is independent and deterministic.

**Remaining headroom:** a binary or structured-clone transfer instead of JSON, skipping the deep-freeze of observations, and caching repeated helper results inside controllers.
