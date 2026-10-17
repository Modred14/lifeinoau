"use client";

import { useMemo } from "react";
import { PLACES, PX_PER_METER, SPOTS, gameMinutesAt, gameTime, vendorOpen } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";

const MAX_VENDORS = 30;
const VENDING = /vending/i;

export interface Vendor {
  spot: number;
  label: string;
  price: number;
  where: string;
  meters: number;
}

function nearestPlace(x: number, y: number): string {
  let best = "Campus";
  let bestDistance = Infinity;
  for (const place of PLACES) {
    const d = Math.hypot(place.door.x - x, place.door.y - y);
    if (d < bestDistance) {
      bestDistance = d;
      best = `near ${place.name}`;
    }
  }
  return best;
}

export function useVendors(view: CampusView): Vendor[] {
  return useMemo(() => {
    const me = view.getRadar().me;
    const seen = new Set<string>();
    const now = gameTime(gameMinutesAt(Date.now()));
    return SPOTS.map((spot, index) => ({ spot, index }))
      .filter(({ spot, index }) => spot.kind === "eat" && !spot.roadside && !VENDING.test(spot.label) && vendorOpen(index, now))
      .map(({ spot, index }) => ({
        spot: index,
        label: spot.label,
        price: spot.price ?? 0,
        where: spot.place >= 0 ? PLACES[spot.place].name : nearestPlace(spot.sx, spot.sy),
        meters: me ? Math.round(Math.hypot(spot.sx - me.x, spot.sy - me.y) / PX_PER_METER) : 0,
      }))
      .sort((a, b) => a.meters - b.meters)
      .filter((vendor) => {
        const key = `${vendor.label}|${vendor.where}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_VENDORS);
  }, [view]);
}
