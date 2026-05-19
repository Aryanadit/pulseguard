import { getRedisClient } from "@pulseguard/redis-client";
import {
  ANALYTICS_BUCKET_PREFIX,
  ANALYTICS_STREAM,
} from "../constants.js";
import { validateRateLimitEvent } from "../event-schema.js";
import type {
  AnalyticsSummaryResponse,
  AnalyticsTimeSeriesPoint,
} from "../types/analytics-response.js";
import { getObservabilitySnapshot } from "./observability-snapshot.service.js";

export interface GetAnalyticsSummaryOptions {
  /**
   * Number of most recent minute buckets to return.
   * Default: 60 (last hour).
   */
  limit?: number;
}

interface AggregateBucket {
  bucketStart: string;
  allowed: number;
  blocked: number;
  errors: number;
  latencySumMs: number;
  sampleCount: number;
}

function parseNumber(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getBucketStart(timestamp: number): string {
  const bucketStartMs = Math.floor(timestamp / 60_000) * 60_000;
  return new Date(bucketStartMs).toISOString();
}

function mergeBucket(
  buckets: Map<string, AggregateBucket>,
  update: AggregateBucket,
): void {
  const current = buckets.get(update.bucketStart);

  if (!current) {
    buckets.set(update.bucketStart, update);
    return;
  }

  current.allowed += update.allowed;
  current.blocked += update.blocked;
  current.errors += update.errors;
  current.latencySumMs += update.latencySumMs;
  current.sampleCount += update.sampleCount;
}

function fieldsToObject(fields: string[]): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: Math.floor(fields.length / 2) }, (_, i) => [
      fields[i * 2] ?? "",
      fields[i * 2 + 1] ?? "",
    ]),
  );
}

async function scanAggregateKeys(): Promise<string[]> {
  const redis = getRedisClient();
  let cursor = "0";
  const keys = new Set<string>();

  do {
    const [nextCursor, batch] = (await redis.scan(
      cursor,
      "MATCH",
      `${ANALYTICS_BUCKET_PREFIX}:*`,
      "COUNT",
      200,
    )) as [string, string[]];

    cursor = nextCursor;
    for (const key of batch) {
      keys.add(key);
    }
  } while (cursor !== "0");

  return Array.from(keys);
}

async function readRedisAggregateBuckets(
  limit: number,
): Promise<AnalyticsTimeSeriesPoint[]> {
  const redis = getRedisClient();
  const keys = await scanAggregateKeys();

  if (keys.length === 0) {
    return [];
  }

  const buckets = new Map<string, AggregateBucket>();
  const rows = await Promise.all(keys.map((key) => redis.hgetall(key)));

  for (const row of rows) {
    const bucketStart = row["bucketStart"];
    if (!bucketStart) {
      continue;
    }

    mergeBucket(buckets, {
      bucketStart,
      allowed: parseNumber(row["allowedCount"]),
      blocked: parseNumber(row["blockedCount"]),
      errors: parseNumber(row["errorCount"]),
      latencySumMs: parseNumber(row["latencySumMs"]),
      sampleCount: parseNumber(row["sampleCount"]),
    });
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
    .slice(-limit)
    .map((bucket) => ({
      bucketStart: bucket.bucketStart,
      allowed: bucket.allowed,
      blocked: bucket.blocked,
      errors: bucket.errors,
      avgLatencyMs:
        bucket.sampleCount > 0 ? bucket.latencySumMs / bucket.sampleCount : 0,
    }));
}

async function readStreamFallbackBuckets(
  limit: number,
): Promise<AnalyticsTimeSeriesPoint[]> {
  const redis = getRedisClient();
  const rows = (await redis.xrevrange(
    ANALYTICS_STREAM,
    "+",
    "-",
    "COUNT",
    5_000,
  )) as [string, string[]][];
  const buckets = new Map<string, AggregateBucket>();

  for (const [, fields] of rows) {
    try {
      const rawEvent = fieldsToObject(fields);
      const event = validateRateLimitEvent(rawEvent);
      const bucketStart = getBucketStart(event.timestamp);

      mergeBucket(buckets, {
        bucketStart,
        allowed: event.allowed ? 1 : 0,
        blocked: event.allowed ? 0 : 1,
        errors: 0,
        latencySumMs: event.latencyMs,
        sampleCount: 1,
      });
    } catch {
      continue;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
    .slice(-limit)
    .map((bucket) => ({
      bucketStart: bucket.bucketStart,
      allowed: bucket.allowed,
      blocked: bucket.blocked,
      errors: bucket.errors,
      avgLatencyMs:
        bucket.sampleCount > 0 ? bucket.latencySumMs / bucket.sampleCount : 0,
    }));
}

export async function getAnalyticsSummary(
  options: GetAnalyticsSummaryOptions = {},
): Promise<AnalyticsSummaryResponse> {
  const { limit = 60 } = options;
  const redisBuckets = await readRedisAggregateBuckets(limit);
  const timeSeries =
    redisBuckets.length > 0
      ? redisBuckets
      : await readStreamFallbackBuckets(limit);

  // Aggregate totals.
  const totals = timeSeries.reduce(
    (acc, point) => {
      acc.allowed += point.allowed;
      acc.blocked += point.blocked;
      acc.errors += point.errors;
      return acc;
    },
    {
      allowed: 0,
      blocked: 0,
      errors: 0,
    },
  );

  // Weighted average latency.
  // Weight by total requests in each bucket so low-volume buckets
  // do not skew the overall result.
  let weightedLatencySum = 0;
  let totalRequests = 0;

  for (const point of timeSeries) {
    const requestsInBucket = point.allowed + point.blocked + point.errors;

    if (requestsInBucket === 0) {
      continue;
    }

    weightedLatencySum += point.avgLatencyMs * requestsInBucket;
    totalRequests += requestsInBucket;
  }

  const averageMs = totalRequests > 0 ? weightedLatencySum / totalRequests : 0;

  return {
    timestamp: new Date().toISOString(),
    totals,
    latency: {
      averageMs,
    },
    timeSeries,
    observability: await getObservabilitySnapshot(),
  };
}
