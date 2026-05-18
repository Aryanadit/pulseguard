interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
}

export function KpiCard({ title, value, subtitle }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-lg shadow-black/20 backdrop-blur-sm">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        {title}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-zinc-50">
        {value}
      </p>
      {subtitle ? (
        <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      ) : null}
    </div>
  );
}
