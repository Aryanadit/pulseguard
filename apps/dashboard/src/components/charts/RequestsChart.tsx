"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalyticsTimeSeriesPoint } from "@pulseguard/analytics";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface RequestsChartProps {
  data: AnalyticsTimeSeriesPoint[];
}

function formatBucketLabel(bucketStart: string): string {
  return new Date(bucketStart).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}

export function RequestsChart({ data }: RequestsChartProps) {
  const { ref, width, height } = useChartSize();
  const chartData = data.map((point) => ({
    ...point,
    label: formatBucketLabel(point.bucketStart),
  }));

  return (
    <div ref={ref} className="h-80 w-full min-w-0">
      {width > 0 && height > 0 ? (
          <LineChart
            width={width}
            height={height}
            data={chartData}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={{ stroke: "#3f3f46" }}
            />
            <YAxis
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={{ stroke: "#3f3f46" }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: "0.5rem",
                color: "#fafafa",
              }}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Legend wrapperStyle={{ color: "#d4d4d8", fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="allowed"
              name="Allowed"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="blocked"
              name="Blocked"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
      ) : null}
    </div>
  );
}
