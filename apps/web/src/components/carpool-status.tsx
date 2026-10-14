import type { runLabel } from "@/lib/carpool-runs";

/** A day's auto-carpool / Optimize status as a colored chip: ⏳ purple while queued
 * or running, green when built, grey when skipped, red when it failed. */
export default function CarpoolStatusBadge({ status, className = "" }: { status: ReturnType<typeof runLabel>; className?: string }) {
  if (!status) return null;
  return (
    <span className={`chip !py-0 max-w-full text-xs ${className}`} style={{ color: status.color, borderColor: status.color }} title={status.text}>
      <span className="truncate">{status.active && "⏳ "}{status.text}</span>
    </span>
  );
}
