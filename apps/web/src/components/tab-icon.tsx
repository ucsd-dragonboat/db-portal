"use client";

import { useEffect } from "react";
import { ICONS } from "@/components/icon";

/** Swaps the browser-tab icon for this section (e.g. a red car on Carpool) while it's
 * mounted. Added as the last <link rel="icon">, which browsers prefer, and removed on
 * the way out so the team logo comes back. */
export default function TabIcon({ icon, color }: { icon: keyof typeof ICONS; color: string }) {
  useEffect(() => {
    const [w, h, , , path] = ICONS[icon].icon;
    const d = Array.isArray(path) ? path.join(" ") : path;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path fill="${color}" d="${d}"/></svg>`;
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [icon, color]);
  return null;
}
