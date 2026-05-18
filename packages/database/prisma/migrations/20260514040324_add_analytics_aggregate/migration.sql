-- CreateTable
CREATE TABLE "AnalyticsAggregate" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "endpoint" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "allowedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "p95LatencyMs" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsAggregate_bucketStart_idx" ON "AnalyticsAggregate"("bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsAggregate_bucketStart_endpoint_tier_key" ON "AnalyticsAggregate"("bucketStart", "endpoint", "tier");
