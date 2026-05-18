import type { FastifyReply, FastifyRequest } from "fastify";
import {
  recordAllowed,
  recordBlocked,
  recordError,
  startRateLimitTimer,
} from "@pulseguard/observability";
import { getRedisClient } from "@pulseguard/redis-client";
import {
  checkRateLimit,
  RateLimitTiers,
  type RateLimitConfig,
} from "@pulseguard/rate-limiter";
import { publishRateLimitEvent } from "@pulseguard/analytics";

/**
 * Extract a stable identifier for rate limiting.
 *
 * Priority:
 * 1. x-api-key header
 * 2. x-forwarded-for (for proxies/load balancers)
 * 3. request.ip
 */
function extractIdentifier(request: FastifyRequest): string {
  // Prefer API key if present.
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return `apikey:${apiKey}`;
  }

  // Respect proxies/load balancers.
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    const ip = forwardedFor.split(",")[0]?.trim();
    if (ip) {
      return `ip:${ip}`;
    }
  }

  // Fallback to socket IP.
  return `ip:${request.ip}`;
}

/**
 * Create a Fastify middleware that enforces distributed rate limiting.
 *
 * This middleware:
 * - Uses Redis + Lua for atomic token bucket enforcement
 * - Adds standards-compliant RateLimit headers
 * - Fails open if Redis is unavailable
 * - Records Prometheus metrics for:
 *   - allowed requests
 *   - blocked requests
 *   - internal errors
 *   - decision latency
 */
export function createRateLimitMiddleware(
  config: RateLimitConfig = RateLimitTiers.default,
) {
  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const redis = getRedisClient();
    const identifier = extractIdentifier(request);

    /**
     * Observability labels.
     *
     * We intentionally keep the `tier` label even though we currently use a
     * single tier value. This demonstrates that the system is designed for
     * future support of plan-based limits such as free, pro, and enterprise.
     */
    const tier = "default";

    /**
     * Use Fastify's normalized route path when available.
     * Falls back to the raw URL if the route path is unavailable.
     */
    const endpoint = request.routeOptions.url ?? request.url;

    // Start histogram timer to measure rate-limit decision latency.
    const stopTimer = startRateLimitTimer(tier, endpoint);

    // High-resolution timer for analytics latency.
    // process.hrtime.bigint() returns time in nanoseconds.
    const startTime = process.hrtime.bigint();

    let result;
    let latencyMs = 0;

    try {
      // Execute the Redis Lua-based token bucket algorithm.
      result = await checkRateLimit(redis, identifier, config);
    } catch (error) {
      // Record internal errors.
      recordError(tier, endpoint);

      // Fail open: Redis outages should not block API traffic.
      request.log.error({ error }, "Rate limiter failed; allowing request");

      return;
    } finally {
      // Compute elapsed time in milliseconds with sub-millisecond precision.
      latencyMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      // Record latency in Prometheus metrics.
      stopTimer();
    }
    // Estimated time (seconds) to fully refill the bucket.
    const resetSeconds = Math.ceil(config.capacity / config.refillRate);

    // Standards-compliant rate limit headers.
    reply.header("RateLimit-Limit", config.capacity);
    reply.header("RateLimit-Remaining", result.remaining);
    reply.header("RateLimit-Reset", resetSeconds);

    // Request exceeds the rate limit.
    if (!result.allowed) {
      // Record blocked request.
      recordBlocked(tier, endpoint);

      await publishRateLimitEvent({
        timestamp: Date.now(),
        identifier,
        endpoint,
        tier,
        allowed: false,
        remaining: result.remaining,
        latencyMs,
      });

      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);

      reply.header("Retry-After", retryAfterSeconds);

      await reply.code(429).send({
        statusCode: 429,
        error: "Too Many Requests",
        message: `Rate limit exceeded. Retry after ${retryAfterSeconds}s.`,
        retryAfter: retryAfterSeconds,
      });

      return;
    }

    // Request was successfully allowed.
    recordAllowed(tier, endpoint);

    await publishRateLimitEvent({
      timestamp: Date.now(),
      identifier,
      endpoint,
      tier,
      allowed: true,
      remaining: result.remaining,
      latencyMs,
    });
  };
}

/**
 * Predefined middleware variants.
 */
export const rateLimitDefault = createRateLimitMiddleware(
  RateLimitTiers.default,
);

export const rateLimitStrict = createRateLimitMiddleware(RateLimitTiers.strict);

export const rateLimitTest = createRateLimitMiddleware(RateLimitTiers.test);
