import { prisma } from "@pulseguard/database";
import type {
  AnalyticsSummaryResponse,
  AnalyticsTimeSeriesPoint,
} from "../types/analytics-response.js";

export interface GetAnalyticsSummaryOptions {
  /**
   * Number of most recent minute buckets to return.
   * Default: 60 (last hour).
   */
  limit?: number;
}

export async function getAnalyticsSummary(
  options: GetAnalyticsSummaryOptions = {},
): Promise<AnalyticsSummaryResponse> {
  const { limit = 60 } = options;

  // Fetch the most recent buckets first.
  const rows = await prisma.analyticsAggregate.findMany({
    orderBy: {
      bucketStart: "desc",
    },
    take: limit,
  });

  // Reorder chronologically for charts.
  const orderedRows = rows.reverse();

  // Convert database rows into API-friendly time series points.
  const timeSeries: AnalyticsTimeSeriesPoint[] = orderedRows.map((row) => ({
    bucketStart: row.bucketStart.toISOString(),
    allowed: row.allowedCount,
    blocked: row.blockedCount,
    errors: row.errorCount,
    avgLatencyMs: row.avgLatencyMs,
  }));

  // Aggregate totals.
  const totals = orderedRows.reduce(
    (acc, row) => {
      acc.allowed += row.allowedCount;
      acc.blocked += row.blockedCount;
      acc.errors += row.errorCount;
      return acc;
    },
    {
      allowed: 0,
      blocked: 0,
      errors: 0,
    },
  );

  // Weighted average latency.
  // Weight by total requests in each bucket so low-volume buckets
  // do not skew the overall result.
  let weightedLatencySum = 0;
  let totalRequests = 0;

  for (const row of orderedRows) {
    const requestsInBucket =
      row.allowedCount + row.blockedCount + row.errorCount;

    if (requestsInBucket === 0) {
      continue;
    }

    weightedLatencySum += row.avgLatencyMs * requestsInBucket;
    totalRequests += requestsInBucket;
  }

  const averageMs = totalRequests > 0 ? weightedLatencySum / totalRequests : 0;

  return {
    timestamp: new Date().toISOString(),
    totals,
    latency: {
      averageMs,
    },
    timeSeries,
  };
}
