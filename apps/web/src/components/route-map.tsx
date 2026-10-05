"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Destination, LatLon, OsrmRoute } from "@db/carpool";
import type { Feature, LineString } from "geojson";

export type MapCar = { id: string; color: string; label: string; points: LatLon[]; route: OsrmRoute | null };

// Free tiles from OpenFreeMap (no API key). Routes from lib/routing.ts (free OSRM / Valhalla / keyed fallbacks).
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

export default function RouteMap({ destination, cars }: { destination: Destination; cars: MapCar[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = new maplibregl.Map({ container: el.current, style: STYLE, center: [destination.lon, destination.lat], zoom: 10 });
    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    return () => { map.current?.remove(); map.current = null; };
  }, [destination.lat, destination.lon]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    const draw = () => {
      // clear previous layers/markers
      for (const l of m.getStyle().layers ?? []) if (l.id.startsWith("route-")) m.removeLayer(l.id);
      for (const s of Object.keys(m.getStyle().sources ?? {})) if (s.startsWith("route-")) m.removeSource(s);
      markers.current.forEach((mk) => mk.remove()); markers.current = [];

      const bounds = new maplibregl.LngLatBounds([destination.lon, destination.lat], [destination.lon, destination.lat]);
      markers.current.push(new maplibregl.Marker({ color: "#111" }).setLngLat([destination.lon, destination.lat]).setPopup(new maplibregl.Popup().setText(destination.label ?? "Destination")).addTo(m));

      for (const c of cars) {
        for (const p of c.points) { bounds.extend([p.lon, p.lat]); }
        c.points.forEach((p, i) => {
          if (p.lat === destination.lat && p.lon === destination.lon) return;
          markers.current.push(new maplibregl.Marker({ color: c.color, scale: i === 0 ? 1 : 0.7 }).setLngLat([p.lon, p.lat]).setPopup(new maplibregl.Popup().setText(`${c.label}${i ? ` · stop ${i}` : " (driver)"}`)).addTo(m));
        });
        const line: Feature<LineString> = c.route
          ? { type: "Feature", properties: {}, geometry: c.route.geometry }
          : { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c.points.map((p) => [p.lon, p.lat]) } };
        if (line.geometry.coordinates.length < 2) continue;
        m.addSource(`route-${c.id}`, { type: "geojson", data: line });
        m.addLayer({ id: `route-${c.id}`, type: "line", source: `route-${c.id}`, paint: { "line-color": c.color, "line-width": 4, "line-opacity": 0.8, ...(c.route ? {} : { "line-dasharray": [2, 2] }) } });
      }
      if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 50, maxZoom: 13, duration: 400 });
    };
    if (m.isStyleLoaded()) draw(); else m.once("load", draw);
  }, [cars, destination]);

  return <div ref={el} className="h-full w-full min-h-[520px]" />;
}
