import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Redis } from "ioredis";

// Recreate __filename and __dirname for ES modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the Lua script once when this module is imported.
// This avoids disk I/O on every request.
const LUA_SCRIPT = readFileSync(join(__dirname, "token-bucket.lua"), "utf-8");

export interface RateLimitConfig {
  capacity: number; // Maximum burst size
  refillRate: number; // Tokens added per second
  cost?: number; // Tokens consumed per request (default: 1)
  keyPrefix?: string; // Namespace prefix in Redis
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  key: string;
}

export async function checkRateLimit(
  redis: Redis,
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { capacity, refillRate, cost = 1, keyPrefix = "rl" } = config;

  const key = `${keyPrefix}:${identifier}`;
  const nowMs = Date.now();

  // Execute the Lua script atomically inside Redis.
  const result = (await redis.eval(
    LUA_SCRIPT,
    1,
    key,
    String(capacity),
    String(refillRate),
    String(cost),
    String(nowMs),
  )) as [number, number, number];

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[2],
    key,
  };
}

// Predefined rate-limit tiers used throughout the application.
export const RateLimitTiers = {
  default: {
    capacity: 200,
    refillRate: 100,
    keyPrefix: "rl:api",
  } satisfies RateLimitConfig,

  strict: {
    capacity: 20,
    refillRate: 10,
    keyPrefix: "rl:strict",
  } satisfies RateLimitConfig,

  test: {
    capacity: 10,
    refillRate: 5,
    keyPrefix: "rl:test",
  } satisfies RateLimitConfig,
} as const;
