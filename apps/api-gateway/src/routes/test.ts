import type { FastifyInstance } from "fastify";

import { rateLimitTest } from "../middleware/rate-limit.js";

export async function testRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/test",
    {
      preHandler: rateLimitTest,
    },
    async (request, reply) => {
      return reply.code(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
        requestId: request.id,
        rateLimit: {
          limit: reply.getHeader("RateLimit-Limit"),
          remaining: reply.getHeader("RateLimit-Remaining"),
          reset: reply.getHeader("RateLimit-Reset"),
        },
      });
    },
  );
}