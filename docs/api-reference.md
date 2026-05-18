# PulseGuard — API Reference

Base URL: `http://localhost:3000`

All endpoints return JSON unless otherwise noted. Rate-limited endpoints include standard `RateLimit-*` headers on every response.

---

## Standard Rate Limit Headers

Every response from a rate-limited endpoint includes:

| Header | Type | Description |
|---|---|---|
| `RateLimit-Limit` | integer | Maximum tokens (burst capacity) for this tier |
| `RateLimit-Remaining` | integer | Tokens remaining in the current bucket |
| `RateLimit-Reset` | integer | Seconds until bucket is fully refilled |
| `Retry-After` | integer | Seconds to wait before retrying (429 responses only) |

---

## Endpoints

### GET /api/test

Rate-limited test endpoint. Use this for load testing and benchmark runs.

**Rate limit tier:** `test` — capacity: 10, refill rate: 5 tokens/second

**Request**
GET /api/test

Optional headers:

| Header | Description |
|---|---|
| `x-api-key` | If present, rate limits by API key instead of IP |
| `x-forwarded-for` | Respected for proxy/load balancer deployments |

**Response — 200 OK**

```json
{
  "status": "ok",
  "timestamp": "2024-04-01T12:00:00.000Z",
  "requestId": "req_abc123",
  "rateLimit": {
    "limit": 10,
    "remaining": 9,
    "reset": 2
  }
}
```

**Response — 429 Too Many Requests**

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry after 1s.",
  "retryAfter": 1
}
```

Headers on 429:
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 2
Retry-After: 1

---

### GET /api/analytics/summary

Returns a snapshot of recent rate limit analytics aggregated from in-memory event history.

**Request**
GET /api/analytics/summary

No authentication required. No rate limiting applied.

**Response — 200 OK**

```json
{
  "totalRequests": 18450,
  "allowedRequests": 17823,
  "blockedRequests": 627,
  "allowRate": 96.6,
  "blockRate": 3.4,
  "recentEvents": [
    {
      "timestamp": 1712000000000,
      "identifier": "ip:127.0.0.1",
      "endpoint": "/api/test",
      "tier": "default",
      "allowed": true,
      "remaining": 87,
      "latencyMs": 3.2
    }
  ]
}
```

**Fields**

| Field | Type | Description |
|---|---|---|
| `totalRequests` | integer | Total events in the current history window |
| `allowedRequests` | integer | Requests that passed the rate limit check |
| `blockedRequests` | integer | Requests rejected with 429 |
| `allowRate` | float | Percentage of requests allowed |
| `blockRate` | float | Percentage of requests blocked |
| `recentEvents` | array | Last 60 rate limit decisions |

**Event fields**

| Field | Type | Description |
|---|---|---|
| `timestamp` | integer | Unix timestamp in milliseconds |
| `identifier` | string | Rate limit key (`apikey:*` or `ip:*`) |
| `endpoint` | string | Normalized route path |
| `tier` | string | Rate limit tier applied |
| `allowed` | boolean | Whether the request was allowed |
| `remaining` | integer | Tokens remaining after this request |
| `latencyMs` | float | Time taken for the rate limit decision (ms) |

---

### GET /api/analytics/stream

Real-time analytics stream via Server-Sent Events. The dashboard connects to this endpoint and receives a fresh analytics snapshot every 3 seconds.

**Request**
GET /api/analytics/stream
Accept: text/event-stream

**Response headers**
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no

**Stream format**

Each event is a JSON-encoded analytics summary pushed as an SSE `data` frame:
data: {"totalRequests":18450,"allowedRequests":17823,"blockedRequests":627,...}
data: {"totalRequests":18503,"allowedRequests":17874,"blockedRequests":629,...}

**Error event**

If the analytics fetch fails server-side:
event: error
data: {"message":"Failed to fetch analytics summary"}

**Behavior**

- Initial snapshot is sent immediately on connection
- Subsequent snapshots are pushed every 3 seconds
- Connection is kept open until the client disconnects
- Server cleans up the interval timer on client disconnect — no resource leak

**Usage (browser)**

```javascript
const source = new EventSource('http://localhost:3000/api/analytics/stream');

source.onmessage = (event) => {
  const summary = JSON.parse(event.data);
  console.log(summary.totalRequests);
};

source.addEventListener('error', (event) => {
  const err = JSON.parse(event.data);
  console.error(err.message);
});
```

---

### GET /health

Liveness check. Returns immediately without touching Redis or PostgreSQL.

**Request**
GET /health

**Response — 200 OK**

```json
{
  "status": "ok",
  "service": "api-gateway",
  "timestamp": 1712000000000,
  "uptime": 3842.5
}
```

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"ok"` if the process is alive |
| `service` | string | Service identifier |
| `timestamp` | integer | Current Unix timestamp in milliseconds |
| `uptime` | float | Process uptime in seconds |

---

### GET /metrics

Prometheus metrics scrape endpoint. Used by the Prometheus server configured in `infrastructure/prometheus/prometheus.yml`.

**Request**
GET /metrics

**Response — 200 OK**
Content-Type: text/plain; version=0.0.4; charset=utf-8

Returns Prometheus exposition format. Example metrics exposed:
HELP pulseguard_requests_allowed_total Total allowed requests
TYPE pulseguard_requests_allowed_total counter
pulseguard_requests_allowed_total{tier="default",endpoint="/api/test"} 17823
HELP pulseguard_requests_blocked_total Total blocked requests
TYPE pulseguard_requests_blocked_total counter
pulseguard_requests_blocked_total{tier="default",endpoint="/api/test"} 627
HELP pulseguard_rate_limit_duration_seconds Rate limit decision latency
TYPE pulseguard_rate_limit_duration_seconds histogram
pulseguard_rate_limit_duration_seconds_bucket{le="0.005",...} 16201
pulseguard_rate_limit_duration_seconds_bucket{le="0.01",...} 18301
pulseguard_rate_limit_duration_seconds_bucket{le="0.025",...} 18450
HELP pulseguard_errors_total Internal rate limiter errors
TYPE pulseguard_errors_total counter
pulseguard_errors_total{tier="default",endpoint="/api/test"} 0

---

## Rate Limit Tiers

| Tier | Capacity | Refill Rate | Use Case |
|---|---|---|---|
| `default` | 200 tokens | 100/second | Standard API endpoints |
| `strict` | 20 tokens | 10/second | Sensitive or expensive endpoints |
| `test` | 10 tokens | 5/second | Load test target (`/api/test`) |

**Token Bucket behaviour:** A client starts with a full bucket (`capacity` tokens). Each request costs 1 token. Tokens refill at `refillRate` per second up to `capacity`. Bursting is allowed up to `capacity` requests before throttling begins.

---

## Identifier Resolution

Rate limiting is applied per identifier, resolved in this priority order:

1. `x-api-key` header → `apikey:{value}`
2. `x-forwarded-for` header (first IP) → `ip:{value}`
3. Socket remote address → `ip:{value}`

Redis key format: `{keyPrefix}:{identifier}`

Example: `rl:api:ip:192.168.1.1`

---

## Error Responses

| Status | Condition |
|---|---|
| `429 Too Many Requests` | Rate limit exceeded — check `Retry-After` header |
| `500 Internal Server Error` | Unexpected server error — rate limiter fails open |
