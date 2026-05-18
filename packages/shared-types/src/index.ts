// Rate Limiting
export interface RateLimitRequest {
  identifier: string;
  route: string;
  method: string;
  timestamp: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

// Analytics
export interface AnalyticsEvent {
  id: string;
  identifier: string;
  route: string;
  method: string;
  allowed: boolean;
  remaining: number;
  latencyMs: number;
  timestamp: number;
}

// Health
export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  service: string;
  timestamp: number;
  uptime: number;
}
