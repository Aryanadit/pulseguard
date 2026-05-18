import {
  ANALYTICS_STREAM,
  validateRateLimitEvent,
} from "@pulseguard/analytics";
import { env } from "@pulseguard/config";
import { getRedisClient } from "@pulseguard/redis-client";
import { createLogger } from "@pulseguard/observability";
import { recordAggregate } from "./aggregate-service.js";

const logger = createLogger("analytics-worker");

const GROUP_NAME = "analytics-group";
const CONSUMER_NAME = `worker-${process.pid}-${env.NODE_ENV}`;

async function ensureConsumerGroup(): Promise<void> {
  const redis = getRedisClient();

  try {
    await redis.xgroup("CREATE", ANALYTICS_STREAM, GROUP_NAME, "0", "MKSTREAM");

    logger.info({ group: GROUP_NAME }, "Created Redis consumer group");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("BUSYGROUP")) {
      logger.debug({ group: GROUP_NAME }, "Consumer group already exists");
      return;
    }

    throw error;
  }
}

export async function startStreamConsumer(): Promise<void> {
  const redis = getRedisClient();

  await ensureConsumerGroup();

  logger.info(
    {
      group: GROUP_NAME,
      consumer: CONSUMER_NAME,
    },
    "Analytics stream consumer started",
  );

  while (true) {
    const result = (await redis.call(
      "XREADGROUP",
      "GROUP",
      GROUP_NAME,
      CONSUMER_NAME,
      "BLOCK",
      "5000",
      "COUNT",
      "10",
      "STREAMS",
      ANALYTICS_STREAM,
      ">",
    )) as [string, [string, string[]][]][] | null;

    if (!result) {
      continue;
    }

    for (const [, messages] of result) {
      for (const [messageId, fields] of messages) {
        try {
          const rawEvent = Object.fromEntries(
            Array.from({ length: fields.length / 2 }, (_, i) => [
              fields[i * 2],
              fields[i * 2 + 1],
            ]),
          );

          const event = validateRateLimitEvent(rawEvent);

          await recordAggregate({
            timestamp: event.timestamp,
            endpoint: event.endpoint,
            tier: event.tier,
            allowed: event.allowed,
            latencyMs: event.latencyMs,
          });

          await redis.xack(ANALYTICS_STREAM, GROUP_NAME, messageId);
        } catch (error) {
          logger.error(
            {
              error,
              messageId,
            },
            "Failed to process analytics event",
          );
        }
      }
    }
  }
}
