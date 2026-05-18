"use client";

import type { AnalyticsTimeSeriesPoint } from "@pulseguard/analytics";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface LatencyChartProps {
  data: AnalyticsTimeSeriesPoint[];
}

function formatBucketLabel(bucketStart: string): string {
  return new Date(bucketStart).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LatencyChart({ data }: LatencyChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    label: formatBucketLabel(point.bucketStart),
  }));

  return (
    <div className="h-80 w-full">
      <div className="min-w-0 h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
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
              unit=" ms"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: "0.5rem",
                color: "#fafafa",
              }}
              labelStyle={{ color: "#a1a1aa" }}
              formatter={(value) => [`${value} ms`, "Avg latency"]}
            />
            <Line
              type="monotone"
              dataKey="avgLatencyMs"
              name="Avg latency"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
