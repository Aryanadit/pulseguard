import type { FastifyInstance } from "fastify";
import { getAnalyticsSummary } from "@pulseguard/analytics";

const ANALYTICS_HISTORY_LIMIT = 60;
const STREAM_INTERVAL_MS = 3_000;

export async function analyticsRoutes(server: FastifyInstance) {
  /**
   * Returns a snapshot of recent analytics data.
   */
  server.get("/api/analytics/summary", async () => {
    const summary = await getAnalyticsSummary({
      limit: ANALYTICS_HISTORY_LIMIT,
    });

    return summary;
  });

  /**
   * Streams live analytics updates using Server-Sent Events (SSE).
   *
   * The browser connects via EventSource and receives a fresh analytics
   * snapshot every few seconds.
   */
  server.get("/api/analytics/stream", async (request, reply) => {
    // Required SSE headers.
    // IMPORTANT: Because we write directly to reply.raw, we must set
    // CORS headers manually for EventSource to work from the Next.js app.
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable proxy buffering (e.g. Nginx)

      // Explicit CORS headers for the dashboard running on localhost:3000.
      "Access-Control-Allow-Origin": "http://localhost:3000",
      "Access-Control-Allow-Credentials": "true",
    });

    /**
     * Sends the latest analytics snapshot to the connected client.
     */
    const sendAnalyticsUpdate = async () => {
      try {
        const summary = await getAnalyticsSummary({
          limit: ANALYTICS_HISTORY_LIMIT,
        });

        reply.raw.write(`data: ${JSON.stringify(summary)}\n\n`);
      } catch (error) {
        const errorPayload = {
          message: "Failed to fetch analytics summary",
        };

        reply.raw.write(
          `event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`,
        );

        server.log.error(error, "Failed to stream analytics update");
      }
    };

    // Send initial snapshot immediately.
    await sendAnalyticsUpdate();

    // Continue sending updates periodically.
    const interval = setInterval(() => {
      void sendAnalyticsUpdate();
    }, STREAM_INTERVAL_MS);

    // Clean up when the client disconnects.
    request.raw.on("close", () => {
      clearInterval(interval);
      reply.raw.end();
    });

    // Tell Fastify that we are handling the response manually.
    return reply;
  });
}
