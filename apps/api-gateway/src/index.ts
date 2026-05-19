import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "@pulseguard/config";
import type { HealthResponse } from "@pulseguard/shared-types";
import { createLogger, register } from "@pulseguard/observability";
import { verifyRedisConnection } from "@pulseguard/redis-client";

import { testRoutes } from "./routes/test.js";
import { analyticsRoutes } from "./routes/analytics.js";

const logger = createLogger("api-gateway");

const server = Fastify({
  logger: false,
});

await server.register(cors, {
  origin: ["http://localhost:3001"],
});

server.get("/health", async (): Promise<HealthResponse> => {
  return {
    status: "ok",
    service: "api-gateway",
    timestamp: Date.now(),
    uptime: process.uptime(),
  };
});

server.get("/metrics", async (_, reply) => {
  const metrics = await register.metrics();

  reply.header("Content-Type", register.contentType);

  return reply.send(metrics);
});

// Register application routes.
await server.register(testRoutes);
await server.register(analyticsRoutes);

const start = async () => {
  try {
    // Ensure Redis is reachable before accepting traffic.
    await verifyRedisConnection();

    await server.listen({
      port: env.API_PORT,
      host: "0.0.0.0",
    });

    logger.info(
      {
        port: env.API_PORT,
      },
      "API Gateway started",
    );
  } catch (error) {
    logger.error(error, "API Gateway failed to start");
    process.exit(1);
  }
};

start();
