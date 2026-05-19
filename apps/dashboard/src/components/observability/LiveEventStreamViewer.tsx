import type { LiveAnalyticsEvent } from "@pulseguard/analytics";
import { Panel } from "./Panel";

interface LiveEventStreamViewerProps {
  events: LiveAnalyticsEvent[];
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function LiveEventStreamViewer({ events }: LiveEventStreamViewerProps) {
  const visibleEvents = events.slice(0, 8);

  return (
    <Panel title="Recent Events">
      {visibleEvents.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Decision</th>
                <th className="px-3 py-2 font-medium">Endpoint</th>
                <th className="px-3 py-2 font-medium">Identifier</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-right font-medium">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {visibleEvents.map((event) => (
                <tr key={event.id} className="text-zinc-300">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-400">
                    {formatTimestamp(event.timestamp)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        event.allowed
                          ? "bg-emerald-950 text-emerald-300"
                          : "bg-red-950 text-red-300"
                      }`}
                    >
                      {event.allowed ? "Allowed" : "Blocked"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {event.endpoint}
                  </td>
                  <td className="max-w-64 truncate px-3 py-2 font-mono text-xs text-zinc-400">
                    {event.identifier}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {event.remaining}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {event.latencyMs.toFixed(3)} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-zinc-500">
          No analytics events in the stream yet
        </p>
      )}
    </Panel>
  );
}
