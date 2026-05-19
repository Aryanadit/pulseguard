"use client";

import { useState } from "react";
import type { EngineeringObservabilitySnapshot } from "@pulseguard/analytics";
import { Metric, Panel } from "./Panel";

interface ObservabilityOverviewProps {
  observability: EngineeringObservabilitySnapshot;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatLag(lagMs: number): string {
  if (lagMs < 1000) {
    return `${lagMs} ms`;
  }

  return `${(lagMs / 1000).toFixed(1)} s`;
}

function formatPreview(preview: Record<string, string> | string[]): string {
  if (Array.isArray(preview)) {
    return preview.join(", ");
  }

  return Object.entries(preview)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function ObservabilityOverview({
  observability,
}: ObservabilityOverviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { redis, eventPipeline, rateLimiter, serviceHealth, redisKeys, benchmark } =
    observability;
  const unhealthyServices = serviceHealth.filter(
    (service) => service.status !== "healthy",
  );

  return (
    <section className="mt-8">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 text-left shadow-lg shadow-black/20 transition hover:border-zinc-700 hover:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="text-sm font-medium text-zinc-200">
            Infrastructure details
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Redis, pipeline, keys, and benchmark internals
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span className="rounded-full border border-zinc-700 px-2.5 py-1">
            {unhealthyServices.length === 0
              ? "All services healthy"
              : `${unhealthyServices.length} service issue${
                  unhealthyServices.length === 1 ? "" : "s"
                }`}
          </span>
          <span className="rounded-full border border-zinc-700 px-2.5 py-1">
            {eventPipeline.pendingEvents.toLocaleString()} pending
          </span>
          <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-200">
            {isOpen ? "Hide details" : "Show details"}
          </span>
        </div>
      </button>

      {isOpen ? (
        <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="System Snapshot">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Redis memory" value={redis.memoryUsedHuman} />
              <Metric
                label="Redis ops/sec"
                value={redis.operationsPerSecond.toLocaleString()}
              />
              <Metric label="Hit ratio" value={formatPercent(redis.hitRatio)} />
              <Metric
                label="Queue lag"
                value={formatLag(eventPipeline.queueLagMs)}
                tone={eventPipeline.queueLagMs < 1000 ? "good" : "warn"}
              />
            </div>
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Services
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                {unhealthyServices.length === 0
                  ? "All services healthy"
                  : unhealthyServices
                      .map((service) => `${service.service}: ${service.status}`)
                      .join(", ")}
              </p>
            </div>
          </Panel>

          <Panel title="Limiter & Pipeline">
            <div className="grid grid-cols-2 gap-3">
              <Metric
                label="Events"
                value={eventPipeline.eventsGenerated.toLocaleString()}
              />
              <Metric
                label="Pending"
                value={eventPipeline.pendingEvents.toLocaleString()}
                tone={eventPipeline.pendingEvents === 0 ? "good" : "warn"}
              />
              <Metric
                label="Processed"
                value={eventPipeline.processedEvents.toLocaleString()}
              />
              <Metric
                label="Failed"
                value={eventPipeline.failedEvents.toLocaleString()}
                tone={eventPipeline.failedEvents === 0 ? "good" : "bad"}
              />
            </div>
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Active bucket
              </p>
              <p className="mt-2 break-all font-mono text-xs text-zinc-400">
                {rateLimiter?.key ?? "No active token bucket"}
              </p>
              {rateLimiter ? (
                <p className="mt-2 text-sm tabular-nums text-zinc-300">
                  {rateLimiter.currentTokens.toFixed(2)} /{" "}
                  {rateLimiter.capacity} tokens, refill{" "}
                  {rateLimiter.refillRatePerSecond}/s
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel title="Redis Keys & Benchmark">
            <div className="space-y-3">
              {redisKeys.slice(0, 4).map((entry) => (
                <div
                  key={entry.key}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-mono text-xs text-zinc-200">
                      {entry.key}
                    </p>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {entry.type}
                    </span>
                  </div>
                  <p className="mt-2 truncate font-mono text-xs text-zinc-500">
                    {formatPreview(entry.preview) || "empty"}
                  </p>
                </div>
              ))}
              {redisKeys.length === 0 ? (
                <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
                  No PulseGuard keys found
                </p>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric
                label="Peak RPS"
                value={benchmark.peakRps.toLocaleString()}
              />
              <Metric
                label="p95 latency"
                value={`${benchmark.p95LatencyMs} ms`}
              />
            </div>
          </Panel>
        </div>
      ) : null}
    </section>
  );
}
