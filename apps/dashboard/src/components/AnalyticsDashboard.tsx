"use client";

import { useAnalyticsStream } from "@/hooks/useAnalyticsStream";
import { KpiCard } from "@/components/KpiCard";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { RequestsChart } from "@/components/charts/RequestsChart";

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export function AnalyticsDashboard() {
  const { data, isLoading, error } = useAnalyticsStream();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-400">Loading analytics…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
        <div className="max-w-md rounded-xl border border-red-900/50 bg-red-950/30 p-6 text-center">
          <p className="text-sm font-medium text-red-300">Connection error</p>
          <p className="mt-2 text-sm text-red-200/80">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { totals, latency, timeSeries, timestamp } = data;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              PulseGuard
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Operational Dashboard
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Live rate limiter and request analytics
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            Last updated {formatTimestamp(timestamp)}
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Allowed Requests" value={totals.allowed.toLocaleString()} />
          <KpiCard title="Blocked Requests" value={totals.blocked.toLocaleString()} />
          <KpiCard title="Errors" value={totals.errors.toLocaleString()} />
          <KpiCard
            title="Average Latency"
            value={`${latency.averageMs.toFixed(3)} ms`}
          />
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-4 text-sm font-medium text-zinc-300">
              Allowed vs Blocked (over time)
            </h2>
            {timeSeries.length > 0 ? (
              <RequestsChart data={timeSeries} />
            ) : (
              <p className="py-16 text-center text-sm text-zinc-500">
                No time series data yet
              </p>
            )}
          </article>

          <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-4 text-sm font-medium text-zinc-300">
              Average latency (over time)
            </h2>
            {timeSeries.length > 0 ? (
              <LatencyChart data={timeSeries} />
            ) : (
              <p className="py-16 text-center text-sm text-zinc-500">
                No latency data yet
              </p>
            )}
          </article>
        </section>
      </div>
    </div>
  );
}
