import { getAnalyticsSummary } from "@pulseguard/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANALYTICS_HISTORY_LIMIT = 60;
const STREAM_INTERVAL_MS = 1_000;

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let isClosed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (isClosed) {
          return;
        }

        isClosed = true;

        if (interval) {
          clearInterval(interval);
        }

        controller.close();
      };

      const send = async () => {
        if (isClosed) {
          return;
        }

        try {
          const summary = await getAnalyticsSummary({
            limit: ANALYTICS_HISTORY_LIMIT,
          });

          if (isClosed) {
            return;
          }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(summary)}\n\n`),
          );
        } catch (error) {
          if (isClosed) {
            return;
          }

          const message =
            error instanceof Error
              ? error.message
              : "Failed to fetch analytics summary";

          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
            ),
          );
        }
      };

      request.signal.addEventListener("abort", close, {
        once: true,
      });

      void send();
      interval = setInterval(() => {
        void send();
      }, STREAM_INTERVAL_MS);
    },
    cancel() {
      isClosed = true;

      if (interval) {
        clearInterval(interval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
