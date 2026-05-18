import { prisma } from "@pulseguard/database";
import { getMinuteBucket } from "../utils/time-bucket.js";

export interface AggregateInput {
  timestamp: number;
  endpoint: string;
  tier: string;
  allowed: boolean;
  latencyMs: number;
}

export async function recordAggregate(input: AggregateInput): Promise<void> {
  const bucketStart = getMinuteBucket(input.timestamp);

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
