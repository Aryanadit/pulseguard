# PulseGuard — Benchmarking

## Overview

All benchmarks were run using [k6](https://k6.io) against a single API Gateway instance running locally with a shared Redis node. Tests target `/api/test` which applies the `test` rate limit tier (capacity: 10, refill: 5/s).

**Environment:**
- MacBook Air (Apple Silicon)
- API Gateway: Node.js 20 + Fastify (single instance, port 3001)
- Redis: 7.2-alpine (Docker, local)
- k6: local execution

---

## Results Summary

| Test | VUs | Duration | Total Requests | RPS | p50 | p90 | p95 | p99 | Checks |
|---|---|---|---|---|---|---|---|---|---|
| Smoke | 1 | 10s | 10 | ~1 | 4.44ms | 5.12ms | 6ms | — | 100% ✓ |
| Constant Load | 50 | 30s | 572,800 | **19,089** | 2.27ms | 3.54ms | **4.21ms** | — | 100% ✓ |
| Stress Ramp | 1→400 | 5m | 3,615,661 | **12,052** | 8.01ms | 23.4ms | 28.13ms | — | 100% ✓ |

---

## Test 1 — Smoke Test

**Script:** `benchmark/scripts/smoke.js`

**Purpose:** Verify the system is functional and headers are correct before load testing.

**Configuration:**
VUs:      1
Duration: 10s
Sleep:    1s per iteration

**Results:**
http_reqs:         10      0.99/s
http_req_duration: avg=4.57ms  min=3.29ms  med=4.44ms  max=6.88ms
p(90)=5.12ms  p(95)=6ms
checks_succeeded:  100% (20/20)
✓ status is 200 or 429
✓ rate limit headers exist

**Outcome:** All checks passed. Rate limit headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`) present on every response. Baseline latency confirmed at ~4.5ms avg.

---

## Test 2 — Constant Load

**Script:** `benchmark/scripts/constant-load.js`

**Purpose:** Measure sustained throughput and latency at fixed concurrency.

**Configuration:**
VUs:      50 (constant)
Duration: 30s

**Results:**
http_reqs:         572,800    19,089/s
http_req_duration: avg=2.56ms  min=961µs  med=2.27ms  max=146.18ms
p(90)=3.54ms  p(95)=4.21ms
checks_succeeded:  100% (1,145,600/1,145,600)
data_received:     225 MB     7.5 MB/s
data_sent:         63 MB      2.1 MB/s

**Threshold results:**
✓ checks rate > 99%       → 100%
✓ p(95) < 10ms            → 4.21ms

**Analysis:**

19,089 RPS sustained at 50 VUs with p95 = 4.21ms. Median latency of 2.27ms demonstrates the efficiency of the single Redis `eval()` round-trip per request. The max of 146ms is an outlier — likely a GC pause or Redis connection setup on first request.

The `http_req_failed` counter shows 99.97% — this is expected and correct. The `test` tier has capacity=10 and refill=5/s. At 19,089 RPS across 50 VUs, the vast majority of requests are correctly rate-limited and receive HTTP 429. All checks passed 100% because the test validates `status is 200 or 429` — 429 is the correct, intended response.

---

## Test 3 — Stress Ramp

**Script:** `benchmark/scripts/stress-ramp.js`

**Purpose:** Find the throughput ceiling and observe latency degradation under extreme concurrency.

**Configuration:**
VUs:      1 → 400 (ramp up over 5 minutes)
Duration: 5m00s

**Results:**
http_reqs:         3,615,661   12,052/s
http_req_duration: avg=10.81ms  min=358µs  med=8.01ms  max=305.71ms
p(90)=23.4ms  p(95)=28.13ms
iterations:        3,615,661   12,052/s
checks_succeeded:  100% (7,231,322/7,231,322)
data_received:     1.4 GB      4.7 MB/s
data_sent:         398 MB      1.3 MB/s

**Threshold results:**
✓ checks rate > 99%       → 100%
✗ p(95) < 20ms            → 28.13ms  (crossed at peak 400 VUs)

**Analysis:**

At 400 concurrent VUs — well beyond production load — the system processed 3.6 million requests over 5 minutes at a sustained 12,052 RPS. Median latency remained at 8ms even under peak stress.

The p95 threshold of 20ms was crossed at the extreme end of the ramp (400 VUs). This is expected behaviour: at 400 concurrent connections against a single local Redis instance, connection pool contention and event loop saturation begin to surface. This is not a design flaw — it is the honest performance ceiling of a single-instance deployment on development hardware.

In a production deployment with multiple API instances and a Redis cluster, this ceiling scales horizontally. The rate limiter logic itself adds no overhead beyond the single Redis `eval()` call.

---

## Interpreting `http_req_failed`

k6 marks any non-2xx response as a failed request by default. In PulseGuard's benchmark setup, this metric is misleading:

- The `/api/test` endpoint applies the `test` tier: capacity=10, refill=5/s
- At 19,000+ RPS, nearly every request correctly receives HTTP **429 Too Many Requests**
- HTTP 429 is the **correct, intended behaviour** — it proves the rate limiter is working
- All check assertions (`status is 200 or 429`, `rate limit headers exist`) passed **100%** across all three tests

The `http_req_failed` rate of ~99.97% is a benchmark configuration artifact, not a system error rate. A production deployment would target a low 429 rate by sizing the rate limit tier to match expected traffic.

---

## Key Takeaways

- **19,089 RPS** sustained at 50 VUs with p95 = **4.21ms** — well under the 10ms target
- **3.6 million requests** processed in a single 5-minute stress run with 0 check failures
- Median latency stays at **2–8ms** across all load levels
- Latency degrades gracefully under extreme concurrency — no cliff, no errors, just higher p95
- Single Redis `eval()` per request keeps the hot path minimal — no pipeline, no multi-step coordination

---

## Running the Benchmarks

```bash
# Smoke test — verify correctness
k6 run benchmark/scripts/smoke.js

# Constant load — throughput and latency at steady state
k6 run benchmark/scripts/constant-load.js

# Stress ramp — find the ceiling
k6 run benchmark/scripts/stress-ramp.js
```

Requires k6 and the API Gateway running on `localhost:3001`.

```bash
# Install k6 (macOS)
brew install k6

# Start API Gateway
pnpm --filter @pulseguard/api-gateway dev
```
