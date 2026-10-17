"use client";

import { useMemo, useState } from "react";
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL, vendorDistanceM, vendorsByDistance, type Point, type Vendor, type VendorCategory } from "@campuslife/shared/market";
import { distance } from "@campus/components/phone/format";
import { VENDOR_COLOR } from "./colors";

const COPY = {
  all: "All",
  approximate: "approx.",
  offMap: "Not on this map",
  directionsOnly: "Directions only",
  view: "View",
};

export function vendorWhere(vendor: Vendor, from: Point | undefined): string {
  const metres = vendorDistanceM(vendor, from);
  if (metres === null) return vendor.point ? vendor.area : `${vendor.area} · ${COPY.offMap}`;
  return `${vendor.area} · ${distance(Math.round(metres))}${vendor.approximate ? ` ${COPY.approximate}` : ""}`;
}

export function VendorList({ from, onPick }: { from: Point | undefined; onPick: (vendor: Vendor) => void }) {
  const [category, setCategory] = useState<VendorCategory | null>(null);
  const vendors = useMemo(() => vendorsByDistance(from, category ?? undefined), [from, category]);
  return (
    <>
      <div className="mk-filters" role="group" aria-label="Kind of place">
        <button type="button" className="mk-filter" aria-pressed={category === null} onClick={() => setCategory(null)}>{COPY.all}</button>
        {VENDOR_CATEGORIES.map((c) => (
          <button key={c} type="button" className="mk-filter" aria-pressed={category === c} onClick={() => setCategory(c)}>{VENDOR_CATEGORY_LABEL[c]}</button>
        ))}
      </div>
      <ul className="mk-list">
        {vendors.map((vendor) => (
          <li key={vendor.id}>
            <button type="button" className="mk-vendor" onClick={() => onPick(vendor)} aria-label={`${COPY.view} ${vendor.name}`}>
              <span className="mk-dot" style={{ background: VENDOR_COLOR[vendor.category] }} aria-hidden="true" />
              <span className="mk-vendor-text">
                <b>{vendor.name}</b>
                <small>{vendorWhere(vendor, from)}</small>
              </span>
              {!vendor.delivers && <span className="mk-tag">{COPY.directionsOnly}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
