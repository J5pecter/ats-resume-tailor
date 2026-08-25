import { cn } from "@/lib/utils";

/** Score meter. Colour is derived from the value, not passed in, so it can't disagree with the number. */
export function ScoreBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone =
    pct >= 75 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--destructive)";

  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="ATS match score"
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: tone }}
      />
    </div>
  );
}
