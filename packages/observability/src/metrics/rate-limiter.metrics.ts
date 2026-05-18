import { Counter, Histogram } from "prom-client";
import { register } from "../registry.js";

const LABEL_NAMES = ["tier", "endpoint"] as const;

export type RateLimitMetricLabels = {
  tier: string;
  endpoint: string;
};

/**
 * Total number of requests allowed by the rate limiter.
 */
export const rateLimitAllowedTotal = new Counter({
  name: "pulseguard_rate_limit_allowed_total",
  help: "Total number of requests allowed by the rate limiter",
  labelNames: LABEL_NAMES,
  registers: [register],

});

/**
 * Total number of requests blocked by the rate limiter.
 */
export const rateLimitBlockedTotal = new Counter({
  name: "pulseguard_rate_limit_blocked_total",
  help: "Total number of requests blocked by the rate limiter",
  labelNames: LABEL_NAMES,
  registers: [register],

});

/**
 * Total number of internal errors encountered while evaluating rate limits.
 */
export const rateLimitErrorsTotal = new Counter({
  name: "pulseguard_rate_limit_errors_total",
  help: "Total number of rate limiter internal errors",
  labelNames: LABEL_NAMES,
  registers: [register],

});

/**
 * Duration of rate limit decision execution in seconds.
 */
export const rateLimitDurationSeconds = new Histogram({
  name: "pulseguard_rate_limit_duration_seconds",
  help: "Time spent evaluating rate limit decisions",
  labelNames: LABEL_NAMES,
  registers: [register],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
});

/**
 * Increment allowed request counter.
 */
export function recordAllowed(tier: string, endpoint: string): void {
  rateLimitAllowedTotal.labels(tier, endpoint).inc();
}

/**
 * Increment blocked request counter.
 */
export function recordBlocked(tier: string, endpoint: string): void {
  rateLimitBlockedTotal.labels(tier, endpoint).inc();
}

/**
 * Increment error counter.
 */
export function recordError(tier: string, endpoint: string): void {
  rateLimitErrorsTotal.labels(tier, endpoint).inc();
}

/**
 * Start a histogram timer.
 *
 * Returns a function that must be called when the operation completes.
 */
export function startRateLimitTimer(
  tier: string,
  endpoint: string,
): () => void {
  const stopTimer = rateLimitDurationSeconds
    .labels(tier, endpoint)
    .startTimer();

  return () => {
    stopTimer();
  };
}
