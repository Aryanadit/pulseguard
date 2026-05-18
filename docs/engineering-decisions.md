# PulseGuard — Engineering Decisions

This document records the key architectural and implementation trade-offs made during the design of PulseGuard. Each decision includes the alternatives considered, the rationale for the choice made, and the consequences.

---

## 1. Token Bucket over Sliding Window Log

**Decision:** Use the Token Bucket algorithm for rate limiting.

**Alternatives considered:**

| Algorithm | Memory per key | Burst handling | Boundary spikes |
|---|---|---|---|
| Fixed Window Counter | O(1) | None | Yes — 2× burst at window edge |
| Sliding Window Log | O(requests) | Exact | No |
| Sliding Window Counter | O(1) | Approximate | Reduced |
| **Token Bucket** | **O(1)** | **Controlled** | **No** |

**Rationale:**

Fixed Window allows a client to send 2× the intended limit by firing requests at the end of one window and the start of the next — a well-known thundering herd problem. Sliding Window Log is exact but stores every request timestamp, which is `O(n)` memory per identifier and collapses under high cardinality.

Token Bucket gives O(1) memory per bucket (two fields: `tokens`, `last_refill_ms`), allows legitimate bursting up to `capacity`, then throttles to `refillRate` tokens/second. This matches real API traffic patterns — clients can absorb short spikes without being penalized, but sustained overload is rejected.

**Consequence:** Clients experience smooth throttling rather than hard window cutoffs. The `retryAfterMs` field in the Lua output gives clients precise backoff timing.

---

## 2. Redis Lua Scripts over MULTI/EXEC Transactions

**Decision:** Execute the entire token bucket operation as a single Redis Lua script.

**Alternatives considered:**

- **GET + SET with application logic** — race condition between read and write; two concurrent requests can both read the same token count and both be allowed
- **MULTI/EXEC (optimistic locking)** — eliminates race condition but requires WATCH, adds round-trips, and fails under contention requiring client-side retry logic
- **Lua script (chosen)** — executes atomically inside Redis, single round-trip, no retry logic needed

**Rationale:**

Redis guarantees that Lua scripts execute atomically — no other command can interleave during script execution. This eliminates the TOCTOU (Time of Check to Time of Use) race condition entirely. The entire decision — read state, compute refill, deduct tokens, write state, set TTL — happens in one `redis.eval()` call.

From the implementation:

```typescript
const result = await redis.eval(
  LUA_SCRIPT, 1, key,
  String(capacity), String(refillRate), String(cost), String(nowMs)
) as [number, number, number];
```

One network round-trip. No retry logic. No race conditions across any number of API instances.

**Consequence:** The rate limiter is correct under horizontal scale by construction, not by coordination.

---

## 3. Fail Open on Redis Unavailability

**Decision:** If Redis is unreachable during a rate limit check, allow the request through rather than rejecting it.

**From the code:**

```typescript
} catch (error) {
  recordError(tier, endpoint);
  // Fail open: Redis outages should not block API traffic.
  request.log.error({ error }, "Rate limiter failed; allowing request");
  return;
}
```

**Alternatives considered:**

- **Fail closed (reject all requests)** — protects against abuse but causes full outage when Redis is down
- **Fail open (allow all requests)** — API remains available; brief window of unprotected traffic

**Rationale:**

For a public-facing API, a Redis outage that causes all requests to return 503 is worse than a brief window of unthrottled traffic. The error is recorded in Prometheus (`recordError`), alerting can fire, and the team can respond. Abuse during a Redis outage is a recoverable situation; a full API outage is not.

**Consequence:** During Redis downtime, the API degrades gracefully to unthrottled mode. Prometheus metrics surface the error rate immediately.

---

## 4. Identifier Extraction Priority

**Decision:** Rate limit by API key > X-Forwarded-For > socket IP, in that order.

**From the code:**

```typescript
function extractIdentifier(request: FastifyRequest): string {
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) return `apikey:${apiKey}`;

  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    const ip = forwardedFor.split(",")[0]?.trim();
    if (ip) return `ip:${ip}`;
  }

  return `ip:${request.ip}`;
}
```

**Rationale:**

IP-based limiting alone is insufficient behind load balancers or NAT — thousands of users may share one egress IP. API key is the most granular and accurate identifier. X-Forwarded-For is respected for proxy deployments. Socket IP is the last resort.

The identifier is namespaced (`apikey:` vs `ip:`) to prevent collisions between identifier types in Redis keyspace.

**Consequence:** The system correctly rate limits individual clients in all deployment topologies — direct, behind proxy, behind load balancer.

---

## 5. Server-Sent Events over WebSockets for Real-Time Dashboard

**Decision:** Use SSE (`text/event-stream`) for streaming analytics to the dashboard.

**Alternatives considered:**

| | SSE | WebSockets |
|---|---|---|
| Direction | Server → Client only | Bidirectional |
| Protocol | HTTP/1.1 | WS upgrade |
| Infrastructure | Standard HTTP (works through proxies) | Requires WS-aware proxy |
| Reconnection | Built into browser EventSource | Manual |
| Complexity | Low | Higher |

**Rationale:**

The dashboard only needs to receive data — it never sends anything back to the server. WebSockets add bidirectional capability that is unused here, along with the infrastructure requirement of a WS-aware proxy and manual reconnection logic. SSE is built on plain HTTP, works through any proxy or CDN, and browsers handle reconnection automatically via the `EventSource` API.

The `X-Accel-Buffering: no` header disables Nginx proxy buffering, ensuring events are delivered immediately rather than batched.

**Consequence:** Simpler server implementation, standard HTTP infrastructure, automatic client reconnection. Trade-off: if the dashboard ever needs to send data back, a separate HTTP endpoint is required.

---

## 6. Async Analytics Worker — Decoupling Write Path

**Decision:** Analytics events are published to an in-process queue and written to PostgreSQL by an async worker, never on the rate limit hot path.

**Rationale:**

PostgreSQL write latency (typically 2–10ms) would add directly to rate limit response latency if writes were synchronous. The rate limit decision itself is complete after the Redis Lua script returns — everything after that is observability data. Publishing to an async worker keeps the hot path latency bounded to the Redis round-trip only.

**Consequence:** Analytics writes can fall behind under extreme load without affecting rate limit latency. This is an acceptable trade-off — analytics are eventually consistent, rate limit decisions are immediately consistent.

---

## 7. Lua Script Loaded Once at Module Import

**Decision:** Read `token-bucket.lua` from disk once when the module is first imported, not on every request.

**From the code:**

```typescript
const LUA_SCRIPT = readFileSync(join(__dirname, "token-bucket.lua"), "utf-8");
```

**Rationale:**

At 10,000+ RPS, a `readFileSync` on every request would add disk I/O to the hot path and thrash the OS page cache. Loading once at startup moves this cost to initialization, where it is paid exactly once per process lifetime.

**Consequence:** The Lua script is immutable after startup. Any changes require a process restart — acceptable for infrastructure-level code.

---

## 8. Standards-Compliant RateLimit Headers

**Decision:** Return `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` headers on every response.

**Rationale:**

These headers follow the IETF RateLimit header fields draft (draft-ietf-httpapi-ratelimit-headers). Clients can implement correct backoff without parsing error message bodies. `Retry-After` on 429 responses gives the exact seconds to wait, derived from the Lua script's `retry_after_ms` output.

**Consequence:** Any standards-compliant HTTP client can implement automatic backoff against PulseGuard without custom integration work.

---

## 9. Turborepo + pnpm Workspaces for Monorepo

**Decision:** Use Turborepo for build orchestration over Nx or a flat multi-package setup.

**Rationale:**

Turborepo's remote caching and dependency-graph-aware task scheduling means packages rebuild only when their inputs change. For a monorepo with 9 packages and 2 apps, this eliminates redundant TypeScript compilation on every change. pnpm's strict hoisting prevents phantom dependency bugs that are common with npm/yarn workspaces.

**Consequence:** Fast incremental builds in development and CI. Package boundaries are enforced — a package cannot accidentally import from a sibling it doesn't declare as a dependency.

---

## 10. Bucket TTL = 2 × Full Refill Time

**Decision:** Set Redis key TTL to `ceil((capacity / refillRate) * 2)` seconds.

**From the Lua script:**

```lua
local ttl_seconds = math.ceil((capacity / refill_rate) * 2)
redis.call("EXPIRE", key, ttl_seconds)
```

**Rationale:**

A TTL equal to exactly one full refill time risks evicting a bucket that a client is actively using at a slow rate. Doubling provides a comfortable margin. For the default tier (capacity=200, refillRate=100), TTL = 4 seconds — idle buckets evict quickly, keeping Redis memory usage proportional to active clients rather than all clients ever seen.

**Consequence:** Redis memory usage is bounded to active traffic windows. No manual cleanup job is required.
