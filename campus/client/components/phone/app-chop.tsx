"use client";

import { useState } from "react";
import Image from "next/image";
import { DELIVERY_FEE, vitalityMessage } from "@campuslife/shared";
import type { CampusView, OrdersView } from "@campus/game/CampusView";
import { ORDER_STATUS, distance, naira } from "./format";
import { useVendors } from "./use-vendors";
import { AppWeb } from "./app-web";
import { AppIcon } from "./app-icon";
import { findApp } from "./apps";
import type { PhoneLive } from "./use-phone-live";

export function AppChop({ view, orders, live, brand = "chop", onClose }: { view: CampusView; orders: OrdersView | null; live: PhoneLive; brand?: "chop" | "chowdeck" | "glovo"; onClose: () => void }) {
  const vendors = useVendors(view);
  const [website, setWebsite] = useState(false);
  const packs = orders?.packs ?? 0;
  const app = findApp(brand);
  if (website) return <><button type="button" className="ph-btn ph-btn-quiet" onClick={() => setWebsite(false)}>Campus orders</button><AppWeb app={app} /></>;
  return (
    <div className={`ph-delivery ph-delivery-${brand}`}>
      {brand !== "chop" && <div className="ph-delivery-brand"><AppIcon app={app} small /><b>{app.label}</b><button type="button" className="ph-site-link" onClick={() => setWebsite(true)}>Real website</button></div>}
      <div className="ph-food-banner"><Image src="/campus/phone/food/jollof.webp" alt="Jollof rice with chicken" width={600} height={338} unoptimized /><h3>What are you eating?</h3></div>
      <p className="ph-note">Campus orders use your game wallet. Delivery {naira(DELIVERY_FEE)}.</p>
      {vitalityMessage(live) && <p className="ph-hunger" role="status">{vitalityMessage(live)}</p>}
      <section className="ph-card ph-row">
        <span>Food packs: {packs}</span>
        <button type="button" className="ph-btn" disabled={!packs || live.food >= 100} onClick={() => view.eatPack()}>Eat one</button>
      </section>
      {orders?.mine && <section className="ph-card ph-order" role="status"><b>{orders.mine.label}</b><span>{ORDER_STATUS[orders.mine.status]}{orders.mine.rider ? ` (${orders.mine.rider})` : ""}</span></section>}
      <h3 className="ph-heading">Nearby kitchens</h3>
      <ul className="ph-list">
        {vendors.map((vendor) => (
          <li key={vendor.spot} className="ph-list-row">
            <span className="ph-list-text"><b>{vendor.label}</b><span className="ph-price">{naira(vendor.price + DELIVERY_FEE)} delivered</span><small>{vendor.where} · {distance(vendor.meters)}</small></span>
            <button type="button" className="ph-btn" disabled={!!orders?.mine || live.cash < vendor.price + DELIVERY_FEE} aria-label={`Order ${vendor.label}${live.cash < vendor.price + DELIVERY_FEE ? ", not enough money" : ""}`} onClick={() => { view.orderFood(vendor.spot); onClose(); }}>Order</button>
          </li>
        ))}
      </ul>
      {!vendors.length && <p className="ph-note">No kitchens are available nearby. Try the food and drinks store.</p>}
    </div>
  );
}
