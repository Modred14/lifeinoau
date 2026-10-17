"use client";

import { useEffect, useState } from "react";
import { VENDORS_CHECKED_ON, findVendor, type Point, type Vendor } from "@campuslife/shared/market";
import { OrderForm } from "./order-form";
import { OrderList } from "./order-list";
import { useMarket } from "./use-market";
import { VendorCard } from "./vendor-card";
import { VendorList } from "./vendor-list";
import "./market.css";

const COPY = {
  intro: "Real places at OAU. A rider buys what you ask for and brings it to you. You pay the rider in real naira when it arrives.",
  checked: `Listings checked ${VENDORS_CHECKED_ON}. Some pins are approximate.`,
  places: "Places",
  orders: "My orders",
  back: "All places",
  placed: "Order placed. A rider will pick it up soon.",
};

type Screen = { name: "list" } | { name: "vendor"; vendor: Vendor } | { name: "order"; vendor: Vendor } | { name: "orders"; placed?: boolean };

interface MarketFlowProps {
  from: Point | undefined;
  /** Opens straight on this vendor, for a pin tapped on the map. */
  vendorId?: string;
  onWalk: (vendor: Vendor) => void;
}

export function MarketFlow({ from, vendorId, onWalk }: MarketFlowProps) {
  const market = useMarket();
  const [screen, setScreen] = useState<Screen>(() => {
    const vendor = findVendor(vendorId);
    return vendor ? { name: "vendor", vendor } : { name: "list" };
  });

  useEffect(() => {
    const vendor = findVendor(vendorId);
    if (vendor) setScreen({ name: "vendor", vendor });
  }, [vendorId]);

  const onList = screen.name === "list" || screen.name === "vendor" || screen.name === "order";
  return (
    <div className="mk">
      <div className="mk-tabs" role="group" aria-label="Errands">
        <button type="button" className="mk-tab" aria-pressed={onList} onClick={() => setScreen({ name: "list" })}>{COPY.places}</button>
        <button type="button" className="mk-tab" aria-pressed={!onList} onClick={() => setScreen({ name: "orders" })}>
          {COPY.orders}{market.openCount ? ` (${market.openCount})` : ""}
        </button>
      </div>
      {screen.name === "list" && (
        <>
          <p className="mk-intro">{COPY.intro}</p>
          <VendorList from={from} onPick={(vendor) => setScreen({ name: "vendor", vendor })} />
          <p className="mk-muted">{COPY.checked}</p>
        </>
      )}
      {screen.name === "vendor" && (
        <>
          <button type="button" className="mk-link" onClick={() => setScreen({ name: "list" })}>{COPY.back}</button>
          <VendorCard vendor={screen.vendor} from={from} onWalk={onWalk} onOrder={(vendor) => setScreen({ name: "order", vendor })} />
        </>
      )}
      {screen.name === "order" && (
        <OrderForm
          vendor={screen.vendor}
          from={from}
          deliveryFeeKobo={market.summary?.deliveryFeeKobo ?? null}
          onBack={() => setScreen({ name: "vendor", vendor: screen.vendor })}
          onPlaced={() => {
            void market.refresh();
            setScreen({ name: "orders", placed: true });
          }}
        />
      )}
      {screen.name === "orders" && (
        <>
          {screen.placed && <p className="mk-success" role="status">{COPY.placed}</p>}
          {market.error && <p className="mk-error" role="alert">{market.error}</p>}
          {market.summary && <OrderList orders={market.summary.orders} onChanged={() => void market.refresh()} />}
        </>
      )}
    </div>
  );
}
