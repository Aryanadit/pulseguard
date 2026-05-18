"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSummaryResponse } from "@pulseguard/analytics";

const SUMMARY_URL = "http://localhost:3001/api/analytics/summary";
const STREAM_URL = "http://localhost:3001/api/analytics/stream";

function parseAnalyticsPayload(raw: string): AnalyticsSummaryResponse {
  return JSON.parse(raw) as AnalyticsSummaryResponse;
}

export function useAnalyticsStream() {
  const [data, setData] = useState<AnalyticsSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitialSummary() {
      try {
        const response = await fetch(SUMMARY_URL);

        if (!response.ok) {
          throw new Error(`Summary request failed (${response.status})`);
        }

        const summary = (await response.json()) as AnalyticsSummaryResponse;

        if (!cancelled) {
          setData(summary);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to load analytics";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchInitialSummary();

    const eventSource = new EventSource(STREAM_URL);

    eventSource.onmessage = (event) => {
      if (cancelled) return;

      try {
        const summary = parseAnalyticsPayload(event.data);
        setData(summary);
        setError(null);
      } catch {
        setError("Received invalid analytics payload from stream");
      }
    };

    eventSource.addEventListener("error", (event) => {
      if (cancelled) return;

      if (event instanceof MessageEvent && event.data) {
        try {
          const payload = JSON.parse(event.data) as { message?: string };
          setError(payload.message ?? "Analytics stream error");
        } catch {
          setError("Analytics stream error");
        }
      }
    });

    eventSource.onerror = () => {
      if (cancelled) return;
      setError((current) => current ?? "Lost connection to analytics stream");
    };

    return () => {
      cancelled = true;
      eventSource.close();
    };
  }, []);

  return { data, isLoading, error };
}
