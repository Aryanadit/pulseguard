import pino from "pino";

export const createLogger = (service: string) =>
  pino({
    level: process.env["NODE_ENV"] === "production" ? "info" : "debug",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

export type Logger = ReturnType<typeof createLogger>;

// Export all custom rate limiter metrics and helper functions
export * from "./metrics/rate-limiter.metrics.js";

// Export the shared Prometheus registry
export * from "./registry.js";
