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

export interface RedisOperationsSnapshot {
  memoryUsedBytes: number;
  memoryUsedHuman: string;
  connectedClients: number;
  totalKeys: number;
  operationsPerSecond: number;
  hitRatio: number;
  keyspaceHits: number;
  keyspaceMisses: number;
}

export interface EventPipelineSnapshot {
  eventsGenerated: number;
  pendingEvents: number;
  processedEvents: number;
  failedEvents: number;
  queueLagMs: number;
}

export interface RateLimiterStateSnapshot {
  key: string;
  currentTokens: number;
  capacity: number;
  refillRatePerSecond: number;
  lastRefillTimestamp: string;
  timeUntilNextTokenMs: number;
}

export type ServiceHealthStatus = "healthy" | "degraded" | "down";

export interface ServiceHealthSnapshot {
  service: string;
  status: ServiceHealthStatus;
  latencyMs: number | null;
  detail: string;
}

export interface LiveAnalyticsEvent {
  id: string;
  timestamp: string;
  identifier: string;
  endpoint: string;
  tier: string;
  allowed: boolean;
  remaining: number;
  latencyMs: number;
}

export interface RedisKeySnapshot {
  key: string;
  type: string;
  ttlSeconds: number;
  size: number;
  preview: Record<string, string> | string[];
}

export interface BenchmarkSummarySnapshot {
  peakRps: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export interface EngineeringObservabilitySnapshot {
  redis: RedisOperationsSnapshot;
  eventPipeline: EventPipelineSnapshot;
  rateLimiter: RateLimiterStateSnapshot | null;
  serviceHealth: ServiceHealthSnapshot[];
  liveEvents: LiveAnalyticsEvent[];
  redisKeys: RedisKeySnapshot[];
  benchmark: BenchmarkSummarySnapshot;
}

export interface AnalyticsSummaryResponse {
  timestamp: string;
  totals: AnalyticsTotals;
  latency: AnalyticsLatency;
  timeSeries: AnalyticsTimeSeriesPoint[];
  observability: EngineeringObservabilitySnapshot;
}
