import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, children, className = "" }: PanelProps) {
  return (
    <article
      className={`rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-lg shadow-black/20 ${className}`}
    >
      <h2 className="mb-4 text-sm font-medium text-zinc-300">{title}</h2>
      {children}
    </article>
  );
}

interface MetricProps {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}

const toneClassNames = {
  default: "text-zinc-50",
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-red-300",
};

export function Metric({ label, value, tone = "default" }: MetricProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-2 break-words text-2xl font-semibold tabular-nums ${toneClassNames[tone]}`}
      >
        {value}
      </p>
    </div>
  );
}
