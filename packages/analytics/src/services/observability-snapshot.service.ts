import { prisma } from "@pulseguard/database";
import { getRedisClient } from "@pulseguard/redis-client";

import { ANALYTICS_STREAM } from "../constants.js";
import type {
  BenchmarkSummarySnapshot,
  EngineeringObservabilitySnapshot,
  EventPipelineSnapshot,
  LiveAnalyticsEvent,
  RateLimiterStateSnapshot,
  RedisKeySnapshot,
  RedisOperationsSnapshot,
  ServiceHealthSnapshot,
  ServiceHealthStatus,
} from "../types/analytics-response.js";

const ANALYTICS_CONSUMER_GROUP = "analytics-group";
const REDIS_KEY_SCAN_COUNT = 100;
const REDIS_KEY_DISPLAY_LIMIT = 12;
const LIVE_EVENT_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 750;

const RATE_LIMIT_TIERS: Record<
  string,
  { capacity: number; refillRatePerSecond: number }
> = {
  "rl:api": {
    capacity: 200,
    refillRatePerSecond: 100,
  },
  "rl:strict": {
    capacity: 20,
    refillRatePerSecond: 10,
  },
  "rl:test": {
    capacity: 10,
    refillRatePerSecond: 5,
  },
};

const BENCHMARK_SUMMARY: BenchmarkSummarySnapshot = {
  peakRps: 19089,
  p50LatencyMs: 2.27,
  p95LatencyMs: 4.21,
  p99LatencyMs: 6.97,
};

const EMPTY_REDIS_OPERATIONS: RedisOperationsSnapshot = {
  memoryUsedBytes: 0,
  memoryUsedHuman: "0B",
  connectedClients: 0,
  totalKeys: 0,
  operationsPerSecond: 0,
  hitRatio: 0,
  keyspaceHits: 0,
  keyspaceMisses: 0,
};

const EMPTY_EVENT_PIPELINE: EventPipelineSnapshot = {
  eventsGenerated: 0,
  pendingEvents: 0,
  processedEvents: 0,
  failedEvents: 0,
  queueLagMs: 0,
};

async function withFallback<T>(
  operation: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await operation;
  } catch {
    return fallback;
  }
}

function parseRedisInfo(info: string): Record<string, string> {
  return Object.fromEntries(
    info
      .split("\r\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf(":");
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}

function parseInteger(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFloatValue(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTotalKeys(info: Record<string, string>): number {
  return Object.entries(info).reduce((total, [key, value]) => {
    if (!key.startsWith("db")) {
      return total;
    }

    const keysMatch = /keys=(\d+)/.exec(value);
    return total + parseInteger(keysMatch?.[1]);
  }, 0);
}

function getTierForKey(key: string): {
  capacity: number;
  refillRatePerSecond: number;
} {
  const tierPrefix = Object.keys(RATE_LIMIT_TIERS).find((prefix) =>
    key.startsWith(`${prefix}:`),
  );

  return tierPrefix ? RATE_LIMIT_TIERS[tierPrefix]! : RATE_LIMIT_TIERS["rl:api"]!;
}

function fieldsToObject(fields: string[]): Record<string, string> {
  const entries = Array.from({ length: Math.floor(fields.length / 2) }, (_, i) => {
    const key = fields[i * 2] ?? "";
    const value = fields[i * 2 + 1] ?? "";
    return [key, value] as const;
  });

  return Object.fromEntries(entries);
}

function redisStreamIdToTimestamp(id: string): string {
  const timestampMs = Number.parseInt(id.split("-")[0] ?? "0", 10);

  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return new Date().toISOString();
  }

  return new Date(timestampMs).toISOString();
}

async function measure<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const start = performance.now();
  const value = await operation();

  return {
    value,
    latencyMs: Math.round(performance.now() - start),
  };
}

async function requestHealth(url: string): Promise<{
  status: ServiceHealthStatus;
  latencyMs: number | null;
  detail: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = performance.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - start);

    return {
      status: response.ok ? "healthy" : "degraded",
      latencyMs,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: "down",
      latencyMs: null,
      detail: error instanceof Error ? error.message : "Request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getRedisOperations(): Promise<RedisOperationsSnapshot> {
  const redis = getRedisClient();
  const info = parseRedisInfo(await redis.info());
  const hits = parseInteger(info["keyspace_hits"]);
  const misses = parseInteger(info["keyspace_misses"]);
  const totalLookups = hits + misses;

  return {
    memoryUsedBytes: parseInteger(info["used_memory"]),
    memoryUsedHuman: info["used_memory_human"] ?? "0B",
    connectedClients: parseInteger(info["connected_clients"]),
    totalKeys: parseTotalKeys(info),
    operationsPerSecond: parseInteger(info["instantaneous_ops_per_sec"]),
    hitRatio: totalLookups > 0 ? hits / totalLookups : 0,
    keyspaceHits: hits,
    keyspaceMisses: misses,
  };
}

async function getEventPipeline(): Promise<EventPipelineSnapshot> {
  const redis = getRedisClient();
  const [streamLength, pending, groups] = await Promise.all([
    redis.xlen(ANALYTICS_STREAM),
    redis
      .xpending(ANALYTICS_STREAM, ANALYTICS_CONSUMER_GROUP)
      .catch(() => null),
    redis.xinfo("GROUPS", ANALYTICS_STREAM).catch(() => []),
  ]);

  const pendingCount = Array.isArray(pending)
    ? parseInteger(String(pending[0]))
    : 0;

  let processedEvents = 0;
  let failedEvents = 0;
  let unreadEvents = 0;

  if (Array.isArray(groups)) {
    for (const group of groups as string[][]) {
      const groupInfo = fieldsToObject(group);
      if (groupInfo["name"] === ANALYTICS_CONSUMER_GROUP) {
        unreadEvents = parseInteger(groupInfo["lag"]);
        failedEvents = parseInteger(groupInfo["pel-count"]);
      }
    }
  }

  processedEvents = Math.max(0, streamLength - pendingCount - unreadEvents);

  const latest = (await redis.xrevrange(
    ANALYTICS_STREAM,
    "+",
    "-",
    "COUNT",
    1,
  )) as [string, string[]][];
  const newestEventId = latest[0]?.[0];
  const queueLagMs = newestEventId
    ? Math.max(0, Date.now() - Number.parseInt(newestEventId.split("-")[0]!, 10))
    : 0;

  return {
    eventsGenerated: streamLength,
    pendingEvents: pendingCount,
    processedEvents,
    failedEvents,
    queueLagMs,
  };
}

async function scanPulseGuardKeys(): Promise<string[]> {
  const redis = getRedisClient();
  let cursor = "0";
  const keys = new Set<string>();

  do {
    const [nextCursor, batch] = (await redis.scan(
      cursor,
      "COUNT",
      REDIS_KEY_SCAN_COUNT,
    )) as [string, string[]];

    cursor = nextCursor;
    for (const key of batch) {
      if (key.startsWith("rl:") || key === ANALYTICS_STREAM) {
        keys.add(key);
      }
    }
  } while (cursor !== "0" && keys.size < REDIS_KEY_DISPLAY_LIMIT * 3);

  return Array.from(keys).sort().slice(0, REDIS_KEY_DISPLAY_LIMIT);
}

async function getRateLimiterState(
  keys: string[],
): Promise<RateLimiterStateSnapshot | null> {
  const redis = getRedisClient();
  const hashKeys = keys.filter((key) => key.startsWith("rl:"));

  for (const key of hashKeys) {
    const type = await redis.type(key);
    if (type !== "hash") {
      continue;
    }

    const state = await redis.hgetall(key);
    const tokens = parseFloatValue(state["tokens"]);
    const lastRefillMs = parseInteger(state["last_refill_ms"]);
    const tier = getTierForKey(key);
    const missingTokens = Math.max(0, Math.ceil(tokens + 1) - tokens);
    const timeUntilNextTokenMs =
      tokens >= tier.capacity
        ? 0
        : Math.ceil((missingTokens / tier.refillRatePerSecond) * 1000);

    return {
      key,
      currentTokens: tokens,
      capacity: tier.capacity,
      refillRatePerSecond: tier.refillRatePerSecond,
      lastRefillTimestamp:
        lastRefillMs > 0
          ? new Date(lastRefillMs).toISOString()
          : new Date().toISOString(),
      timeUntilNextTokenMs,
    };
  }

  return null;
}

async function getRedisKeys(keys: string[]): Promise<RedisKeySnapshot[]> {
  const redis = getRedisClient();

  return Promise.all(
    keys.map(async (key) => {
      const [type, ttlSeconds, size] = await Promise.all([
        redis.type(key),
        redis.ttl(key),
        redis.memory("USAGE", key).then((value) => Number(value ?? 0)),
      ]);

      let preview: Record<string, string> | string[] = [];

      if (type === "hash") {
        preview = await redis.hgetall(key);
      } else if (type === "stream") {
        preview = [`length=${await redis.xlen(key)}`];
      } else if (type === "string") {
        const value = await redis.get(key);
        preview = value ? [value.slice(0, 120)] : [];
      }

      return {
        key,
        type,
        ttlSeconds,
        size,
        preview,
      };
    }),
  );
}

async function getLiveEvents(): Promise<LiveAnalyticsEvent[]> {
  const redis = getRedisClient();
  const rows = (await redis.xrevrange(
    ANALYTICS_STREAM,
    "+",
    "-",
    "COUNT",
    LIVE_EVENT_LIMIT,
  )) as [string, string[]][];

  return rows.map(([id, fields]) => {
    const event = fieldsToObject(fields);

    return {
      id,
      timestamp: event["timestamp"]
        ? new Date(parseInteger(event["timestamp"])).toISOString()
        : redisStreamIdToTimestamp(id),
      identifier: event["identifier"] ?? "unknown",
      endpoint: event["endpoint"] ?? "unknown",
      tier: event["tier"] ?? "default",
      allowed: event["allowed"] === "true",
      remaining: parseInteger(event["remaining"]),
      latencyMs: parseFloatValue(event["latencyMs"]),
    };
  });
}

async function getServiceHealth(): Promise<ServiceHealthSnapshot[]> {
  const redis = getRedisClient();
  const [redisHealth, postgresHealth, prometheusHealth, grafanaHealth] =
    await Promise.all([
      measure(() => redis.ping())
        .then(({ value, latencyMs }) => ({
          service: "Redis",
          status: (value === "PONG"
            ? "healthy"
            : "degraded") as ServiceHealthStatus,
          latencyMs,
          detail: value,
        }))
        .catch((error) => ({
          service: "Redis",
          status: "down" as const,
          latencyMs: null,
          detail: error instanceof Error ? error.message : "Ping failed",
        })),
      measure(() => prisma.$queryRaw`SELECT 1`)
        .then(({ latencyMs }) => ({
          service: "PostgreSQL",
          status: "healthy" as const,
          latencyMs,
          detail: "SELECT 1",
        }))
        .catch((error) => ({
          service: "PostgreSQL",
          status: "down" as const,
          latencyMs: null,
          detail: error instanceof Error ? error.message : "Query failed",
        })),
      requestHealth("http://localhost:9090/-/healthy").then((result) => ({
        service: "Prometheus",
        ...result,
      })),
      requestHealth("http://localhost:3002/api/health").then((result) => ({
        service: "Grafana",
        ...result,
      })),
    ]);

  return [
    {
      service: "API Gateway",
      status: "healthy",
      latencyMs: 0,
      detail: "Serving analytics stream",
    },
    redisHealth,
    postgresHealth,
    prometheusHealth,
    grafanaHealth,
    {
      service: "Dashboard",
      status: "healthy",
      latencyMs: null,
      detail: "SSE client connected",
    },
  ];
}

export async function getObservabilitySnapshot(): Promise<EngineeringObservabilitySnapshot> {
  const keys = await scanPulseGuardKeys().catch(() => []);
  const [
    redis,
    eventPipeline,
    rateLimiter,
    serviceHealth,
    liveEvents,
    redisKeys,
  ] = await Promise.all([
    withFallback(getRedisOperations(), EMPTY_REDIS_OPERATIONS),
    withFallback(getEventPipeline(), EMPTY_EVENT_PIPELINE),
    withFallback(getRateLimiterState(keys), null),
    getServiceHealth(),
    withFallback(getLiveEvents(), []),
    withFallback(getRedisKeys(keys), []),
  ]);

  return {
    redis,
    eventPipeline,
    rateLimiter,
    serviceHealth,
    liveEvents,
    redisKeys,
    benchmark: BENCHMARK_SUMMARY,
  };
}
