import { prisma } from "@pulseguard/database";
import {
  ANALYTICS_BUCKET_PREFIX,
  ANALYTICS_BUCKET_TTL_SECONDS,
} from "@pulseguard/analytics";
import { createLogger } from "@pulseguard/observability";
import { getRedisClient } from "@pulseguard/redis-client";
import { getMinuteBucket } from "../utils/time-bucket.js";

const logger = createLogger("analytics-worker");

export interface AggregateInput {
  timestamp: number;
  endpoint: string;
  tier: string;
  allowed: boolean;
  latencyMs: number;
}

function getAggregateKey(bucketStart: Date, endpoint: string, tier: string): string {
  return [
    ANALYTICS_BUCKET_PREFIX,
    bucketStart.getTime(),
    encodeURIComponent(endpoint),
    encodeURIComponent(tier),
  ].join(":");
}

async function recordRedisAggregate(
  input: AggregateInput,
  bucketStart: Date,
): Promise<void> {
  const redis = getRedisClient();
  const key = getAggregateKey(bucketStart, input.endpoint, input.tier);
  const requestCountField = input.allowed ? "allowedCount" : "blockedCount";

  await redis
    .multi()
    .hset(key, {
      bucketStart: bucketStart.toISOString(),
      endpoint: input.endpoint,
      tier: input.tier,
    })
    .hincrby(key, requestCountField, 1)
    .hincrbyfloat(key, "latencySumMs", input.latencyMs)
    .hincrby(key, "sampleCount", 1)
    .expire(key, ANALYTICS_BUCKET_TTL_SECONDS)
    .exec();
}

async function recordPostgresAggregate(
  input: AggregateInput,
  bucketStart: Date,
): Promise<void> {
  await prisma.analyticsAggregate.upsert({
    where: {
      bucketStart_endpoint_tier: {
        bucketStart,
        endpoint: input.endpoint,
        tier: input.tier,
      },
    },
    update: {
      allowedCount: input.allowed ? { increment: 1 } : undefined,
      blockedCount: !input.allowed ? { increment: 1 } : undefined,
      avgLatencyMs: input.latencyMs,
    },
    create: {
      bucketStart,
      endpoint: input.endpoint,
      tier: input.tier,
      allowedCount: input.allowed ? 1 : 0,
      blockedCount: input.allowed ? 0 : 1,
      avgLatencyMs: input.latencyMs,
    },
  });
}

export async function recordAggregate(input: AggregateInput): Promise<void> {
  const bucketStart = getMinuteBucket(input.timestamp);

  await recordRedisAggregate(input, bucketStart);

  try {
    await recordPostgresAggregate(input, bucketStart);
  } catch (error) {
    logger.warn(
      {
        error,
        bucketStart: bucketStart.toISOString(),
        endpoint: input.endpoint,
        tier: input.tier,
      },
      "Failed to persist analytics aggregate to PostgreSQL",
    );
  }
}
