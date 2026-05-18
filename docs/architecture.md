# PulseGuard — Architecture

## Overview

PulseGuard is a distributed rate limiting and real-time analytics platform built for horizontal scalability and sub-15ms p99 latency. The system is intentionally stateless at the API layer — all shared state lives in Redis — allowing multiple API instances to scale linearly without coordination overhead.

---

## System Topology

      ┌─────────────────────────────────────────────────────────┐
      │                 Clients / k6 Load Tests                 │
      └────────────────────────────┬────────────────────────────┘
                                   │ HTTP
      ┌────────────────────────────▼────────────────────────────┐
      │                      API Gateway                        │
      │                 Fastify + TypeScript                    │
      │                                                         │
      │    Instance 1 (:3000)   │    Instance 2 (:3001)         │ ◄─── (Horizontally Scaled)
      └──────────┬───────────────────────────┬────────────┬─────┘
                 │                           │            │
                 │ (Hot Path)                │ (Async)    │ (Scrape)
      ┌──────────▼──────────┐      ┌─────────▼────────┐   │
      │      Redis 7.2      │      │ Analytics Worker │   │
      │ ─────────────────── │      └─────────┬────────┘   │
      │  • Token Bucket     │                │            │
      │  • Lua Scripts      │      ┌─────────▼────────┐   │   ┌──────────────────────┐
      │  • Shared State     │      │  PostgreSQL 16   │   ├──►│      Prometheus      │
      └─────────────────────┘      │ ──────────────── │   │   │ Metrics Ingest (:9090│
                                   │  • Analytics DB  │   │   └──────────┬───────────┘
                                   │  • Prisma ORM    │   │              │
                                   └──────────────────┘   │              │ Query
                                                          │   ┌──────────▼───────────┐
                                                          └──►│  Grafana Dashboard   │
                                                              │       (:3003)        │
                                                              └──────────────────────┘

---

## Component Breakdown

### API Gateway (`apps/api-gateway`)

- Built on **Fastify** for minimal overhead and high throughput
- Exposes three surface areas: rate limit checks, analytics ingestion, and Prometheus metrics
- Verifies Redis connectivity on startup before accepting traffic — fails fast rather than serving degraded
- Registers routes modularly: `testRoutes`, `analyticsRoutes`
- CORS configured for dashboard origin

**Key routes:**
| Route | Purpose |
|---|---|
| `POST /test/rate-limit` | Execute rate limit check via Lua script |
| `GET /analytics/stream` | SSE stream for real-time dashboard |
| `POST /analytics/event` | Ingest analytics event |
| `GET /metrics` | Prometheus scrape endpoint |
| `GET /health` | Liveness check |

---

### Rate Limiter (`packages/rate-limiter`)

The core of PulseGuard. Implements the **Token Bucket algorithm** executed atomically inside Redis via a Lua script.

#### Why Token Bucket

Token Bucket allows controlled bursting — a client can consume accumulated tokens for a short spike, then is throttled to the refill rate. This matches real-world API traffic patterns better than Fixed Window, which causes thundering herds at window boundaries.

#### Why Lua Scripts

The entire rate limit decision — read state, compute refill, deduct tokens, write state, set TTL — executes as a **single atomic operation** inside Redis. This eliminates the TOCTOU race condition that exists when using `GET` + `SET` with Redis transactions (`MULTI/EXEC`). No two requests can interleave on the same bucket key.

#### Lua Script Logic (`token-bucket.lua`)

Input: KEYS[1] = bucket key
ARGV[1] = capacity (max tokens)
ARGV[2] = refill_rate (tokens/second)
ARGV[3] = cost (tokens this request consumes)
ARGV[4] = now_ms (current timestamp)
Steps:

HMGET current tokens + last_refill_ms
If key missing → initialize full bucket
Compute elapsed seconds since last refill
Add (elapsed × refill_rate) tokens, capped at capacity
If tokens >= cost → deduct, set allowed = 1
Else → compute retry_after_ms = ceil(deficit / refill_rate × 1000)
HMSET updated state, EXPIRE with 2× full-refill TTL

Output: [allowed, remaining_tokens, retry_after_ms]

The TTL of `2 × (capacity / refill_rate)` seconds ensures idle buckets are automatically evicted, preventing unbounded Redis memory growth.

#### Rate Limit Tiers

```typescript
RateLimitTiers.default → capacity: 200, refillRate: 100/s   // Standard API
RateLimitTiers.strict  → capacity: 20,  refillRate: 10/s    // Sensitive endpoints
RateLimitTiers.test    → capacity: 10,  refillRate: 5/s     // Load test target
```

#### TypeScript Interface

```typescript
checkRateLimit(redis, identifier, config) → Promise<{
  allowed: boolean,
  remaining: number,
  retryAfterMs: number,
  key: string
}>
```

The Lua script is loaded once at module import time — no disk I/O on the hot path.

---

### Redis (`redis:7.2-alpine`)

- Configured with `--appendonly yes` for persistence across restarts
- `--maxmemory 256mb` with `allkeys-lru` eviction — safe ceiling for development
- Bucket keys use the pattern `rl:{prefix}:{identifier}`
- All rate limit state is stored as Redis hashes: `{ tokens, last_refill_ms }`
- Healthcheck: `redis-cli ping` before API instances start

**Why Redis over in-process state:**
In-process token buckets cannot be shared across API instances. Two instances handling requests for the same identifier would each maintain separate counters, allowing 2× the intended limit. Redis as shared state store is the only correct solution for horizontal scaling.

---

### PostgreSQL 16 (`postgres:16-alpine`)

- Stores historical analytics events for dashboard time-series queries
- Accessed exclusively via **Prisma ORM** — type-safe queries, schema-as-code
- Writes are handled by the async analytics worker — never on the hot path
- Healthcheck: `pg_isready` before dependent services start

---

### Analytics Worker (`packages/analytics-worker`)

Decouples analytics persistence from request handling. The API gateway publishes events; the worker consumes and writes to PostgreSQL asynchronously. This ensures PostgreSQL write latency never contributes to rate limit check latency.

---

### Observability Stack

#### Prometheus (`prom/prometheus:v2.51.0`)

- Scrapes `/metrics` from each API instance
- Config mounted from `infrastructure/prometheus/prometheus.yml`
- Retention stored in named Docker volume

#### Grafana (`grafana/grafana:10.4.0`)

- Provisioned automatically via `infrastructure/grafana/provisioning`
- Pre-configured Prometheus datasource and dashboards
- Access: `http://localhost:3002` — credentials: `admin / pulseguard`

**Metrics exposed:**

- Request throughput per instance (RPS)
- Rate limit allow / deny counts
- Redis operation latency histograms
- Token bucket utilization per tier

---

## Data Flow — Rate Limit Request

Client sends POST /test/rate-limit
Fastify middleware extracts identifier + tier
checkRateLimit() called with Redis client + config
redis.eval() sends Lua script + args to Redis
Redis executes atomically:
a. Read bucket state (HMGET)
b. Compute refill based on elapsed time
c. Deduct tokens if sufficient
d. Write updated state (HMSET + EXPIRE)
Result: { allowed, remaining, retryAfterMs }
Fastify returns HTTP 200 (allowed) or 429 (denied)
Prometheus counter incremented
Analytics event published async

Total Redis round-trip: 1 command (eval). No pipeline needed for the hot path.

---

## Data Flow — Real-Time Dashboard

Next.js dashboard opens GET /analytics/stream
Fastify keeps connection open (SSE / text-event-stream)
On each rate limit decision, API emits SSE event
Dashboard receives event, updates Recharts in real time
No polling — push-based, zero wasted requests

---

## Horizontal Scaling Design

Both API instances connect to the **same Redis** and **same PostgreSQL**. There is no instance-local state. Scaling from 2 → N instances requires only adding entries to `docker-compose.yml` — no code changes.

This is intentional: the architecture demonstrates that the rate limiter is a **distributed primitive**, not an application-level feature.

---

## Failure Modes & Resilience

| Failure                      | Behavior                                                |
| ---------------------------- | ------------------------------------------------------- |
| Redis unreachable at startup | API refuses to start (verifyRedisConnection)            |
| Redis timeout mid-request    | Error propagated, 500 returned, not silently allowed    |
| PostgreSQL unreachable       | Analytics writes fail silently; rate limiting continues |
| Instance crash               | Other instances continue; Redis state preserved         |
| Idle bucket keys             | Auto-evicted via EXPIRE TTL                             |

The system is designed to **fail closed** on Redis — a rate limiter that fails open under Redis outage provides no protection.

---

## Monorepo Structure

Built with **pnpm Workspaces + Turborepo**. Each package has a single responsibility:

| Package            | Responsibility                           |
| ------------------ | ---------------------------------------- |
| `rate-limiter`     | Token bucket logic + Lua script          |
| `redis-client`     | Shared ioredis connection factory        |
| `analytics`        | Event schema + SSE publisher             |
| `analytics-worker` | Async PostgreSQL persistence             |
| `observability`    | Prometheus register + metric definitions |
| `database`         | Prisma client + schema                   |
| `shared-types`     | Cross-package TypeScript interfaces      |
| `config`           | Environment variable validation          |
| `errors`           | Typed error classes                      |

Turborepo's dependency graph ensures packages build in correct order and only rebuild on change.
