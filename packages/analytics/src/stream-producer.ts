import { getRedisClient } from "@pulseguard/redis-client";
import { createLogger } from "@pulseguard/observability";
import { ANALYTICS_STREAM, MAX_STREAM_LENGTH } from "./constants.js";
import { RateLimitEvent, validateRateLimitEvent } from "./event-schema.js";

const logger = createLogger("analytics");

export async function publishRateLimitEvent(
  event: RateLimitEvent,
): Promise<void> {
  try {
    const validated = validateRateLimitEvent(event);
    const redis = getRedisClient();

    await redis.xadd(
      ANALYTICS_STREAM,
      "MAXLEN",
      "~",
      MAX_STREAM_LENGTH,
      "*",
      "timestamp",
      String(validated.timestamp),
      "identifier",
      validated.identifier,
      "endpoint",
      validated.endpoint,
      "tier",
      validated.tier,
      "allowed",
      String(validated.allowed),
      "remaining",
      String(validated.remaining),
      "latencyMs",
      String(validated.latencyMs),
    );
  } catch (error) {
    logger.warn(
      {
        err: error,
        stream: ANALYTICS_STREAM,
      },
      "Failed to publish analytics event",
    );
  }
}
