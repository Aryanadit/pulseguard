import { loadRootEnv } from "./load-env.js";

loadRootEnv();

import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const pool = new Pool({
  connectionString,
});

const adapter = new PrismaPg(pool);

declare global {
  // Prevent multiple Prisma clients during development hot reloads.
  // eslint-disable-next-line no-var
  var __pulseguardPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__pulseguardPrisma__ ??
  new PrismaClient({
    adapter,
    log:
      process.env["NODE_ENV"] === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalThis.__pulseguardPrisma__ = prisma;
}
