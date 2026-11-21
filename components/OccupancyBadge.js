// components/OccupancyBadge.js
// "3 people inside", drawn just under a building's name tag on the map. Only real players are ever counted (the realtime server, lib/occupancy.js).
// Nothing at all is drawn while nobody is inside: no "0", no empty chip. It reads ONE building's number, so a change redraws only this badge, not the map.
"use client";
import { useEffect, useRef } from "react";
import { useOccupancy } from "@/lib/occupancyClient";

export const occupancyText = (n) => `${n} ${n === 1 ? "person" : "people"} inside`;

export default function OccupancyBadge({ id }) {
  const n = useOccupancy(id), ref = useRef(null);
  // the name tag is a button with its own label, which screen readers read instead of what is inside it: so the count is also given as its description
  useEffect(() => {
    const btn = ref.current?.closest("button");
    if (!btn || !n) return undefined;
    btn.setAttribute("aria-description", occupancyText(n));
    return () => btn.removeAttribute("aria-description");
  }, [n]);
  if (!n) return null;
  return <em className="occ" ref={ref} data-n={n}>{occupancyText(n)}</em>;
}
