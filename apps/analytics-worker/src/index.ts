import { createLogger } from "@pulseguard/observability";
import { env } from "@pulseguard/config";
import { startStreamConsumer } from "./services/stream-consumer.js";

const logger = createLogger("analytics-worker");

const startWorker = async (): Promise<void> => {
  try {
    logger.info({ env: env.NODE_ENV }, "Analytics Worker started");

    await startStreamConsumer();
  } catch (error) {
    logger.error({ error }, "Worker startup failed");
    process.exit(1);
  }
};

startWorker();
