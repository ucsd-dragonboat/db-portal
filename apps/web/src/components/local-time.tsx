"use client";

import { useSyncExternalStore } from "react";
import { TEAM_TZ, fmtDate, fmtDateTime, fmtTime } from "@/lib/format";

const subscribe = () => () => {};
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false);

type Mode = "datetime" | "date" | "time" | "month" | "day" | "weekday";

/**
 * Renders a timestamp in the viewer's browser timezone. Server-renders in the team timezone
 * (TEAM_TZ) so first paint is sane, then re-renders locally after hydration — no mismatch.
 */
export default function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: Mode }) {
  const mounted = useMounted();
  const tz = mounted ? undefined : TEAM_TZ;
  const d = new Date(iso);
  let text: string;
  switch (mode) {
    case "date": text = fmtDate(iso, tz); break;
    case "time": text = fmtTime(iso, tz); break;
    case "month": text = d.toLocaleDateString(undefined, { month: "short", timeZone: tz }); break;
    case "day": text = d.toLocaleDateString(undefined, { day: "numeric", timeZone: tz }); break;
    case "weekday": text = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: tz }); break;
    default: text = fmtDateTime(iso, tz);
  }
  return <time dateTime={iso} title={mounted ? d.toString() : undefined}>{text}</time>;
}
