export interface AnalyticsTotals {
  allowed: number;
  blocked: number;
  errors: number;
}

export interface AnalyticsLatency {
  averageMs: number;
}

export interface AnalyticsTimeSeriesPoint {
  bucketStart: string;
  allowed: number;
  blocked: number;
  errors: number;
  avgLatencyMs: number;
}

export interface AnalyticsSummaryResponse {
  timestamp: string;
  totals: AnalyticsTotals;
  latency: AnalyticsLatency;
  timeSeries: AnalyticsTimeSeriesPoint[];
}
