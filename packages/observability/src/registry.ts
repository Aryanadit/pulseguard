import { Registry, collectDefaultMetrics } from "prom-client";

/**
 * Shared Prometheus registry used across the entire application.
 * All default and custom metrics are registered here.
 */
export const register = new Registry();

/**
 * Default labels applied to every metric.
 */
register.setDefaultLabels({
  app: "api-gateway",
});

/**
 * Collect Node.js runtime metrics such as:
 * - CPU usage
 * - Memory usage
 * - Event loop lag
 * - Garbage collection
 */
collectDefaultMetrics({
  register,
});
