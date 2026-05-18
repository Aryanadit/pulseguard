import { Redis } from "ioredis";

import { env } from "@pulseguard/config";
import { createLogger } from "@pulseguard/observability";

const logger = createLogger("redis-client");

// Singleton Redis connection shared across the process.
let redis: Redis | undefined;

export function getRedisClient(): Redis {
  if (!redis) {
    const client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    client.on("connect", () => {
      logger.info("Connected to Redis");
    });

    client.on("ready", () => {
      logger.info("Redis client ready");
    });

    client.on("error", (error: Error) => {
      logger.error({ error }, "Redis connection error");
    });

    client.on("close", () => {
      logger.warn("Redis connection closed");
    });

    client.on("reconnecting", () => {
      logger.warn("Reconnecting to Redis");
    });

    redis = client;
  }

  // TypeScript knows redis is defined because we assign it above.
  return redis!;
}

export async function verifyRedisConnection(): Promise<void> {
  const client = getRedisClient();

  if (client.status === "wait") {
    await client.connect();
  }

  const response = await client.ping();

  if (response !== "PONG") {
    throw new Error("Redis ping failed");
  }

  logger.info("Redis connectivity verified");
}

export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = undefined;
    logger.info("Redis connection closed gracefully");
  }
}

export type RedisClient = Redis;
