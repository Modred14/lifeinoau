"use client";

import { VENDOR_CATEGORY_LABEL, type Point, type Vendor } from "@campuslife/shared/market";
import { vendorWhere } from "./vendor-list";
import { VENDOR_COLOR } from "./colors";

const COPY = {
  approximate: "The pin is on the building or area, not the exact shop. Ask around when you get there.",
  offMap: "This place is outside the campus map, so we can't walk you there.",
  noDelivery: "We don't deliver from here. Use it to find your way.",
  walk: "Walk there",
  order: "Order delivery",
  source: "Where this listing comes from",
  hours: "Open",
};

interface VendorCardProps {
  vendor: Vendor;
  from: Point | undefined;
  onWalk: (vendor: Vendor) => void;
  onOrder: (vendor: Vendor) => void;
}

export function VendorCard({ vendor, from, onWalk, onOrder }: VendorCardProps) {
  return (
    <article className="mk-card">
      <p className="mk-kind"><span className="mk-dot" style={{ background: VENDOR_COLOR[vendor.category] }} aria-hidden="true" />{VENDOR_CATEGORY_LABEL[vendor.category]}</p>
      <h3 className="mk-title">{vendor.name}</h3>
      <p className="mk-where">{vendorWhere(vendor, from)}</p>
      {vendor.about && <p>{vendor.about}</p>}
      {vendor.hours && <p>{COPY.hours}: {vendor.hours}</p>}
      {vendor.approximate && <p className="mk-muted">{COPY.approximate}</p>}
      {!vendor.point && <p className="mk-muted">{COPY.offMap}</p>}
      {!vendor.delivers && <p className="mk-muted">{COPY.noDelivery}</p>}
      <div className="mk-actions">
        {vendor.delivers && <button type="button" className="mk-btn" onClick={() => onOrder(vendor)}>{COPY.order}</button>}
        {vendor.point && <button type="button" className={`mk-btn${vendor.delivers ? " mk-btn-quiet" : ""}`} onClick={() => onWalk(vendor)}>{COPY.walk}</button>}
      </div>
      <a className="mk-source" href={vendor.source} target="_blank" rel="noreferrer noopener">{COPY.source}</a>
    </article>
  );
}
