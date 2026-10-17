"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { SHOP_ITEMS, vitalityMessage, type ShopItem, type ShopReceipt } from "@campuslife/shared";
import { PiCoffeeFill, PiDropFill, PiForkKnifeFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import type { PhoneLive } from "./use-phone-live";
import { naira } from "./format";

let sequence = Date.now();

export function AppMarket({ view, live }: { view: CampusView; live: PhoneLive }) {
  const [receipt, setReceipt] = useState<ShopReceipt | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const busy = useRef(false);
  useEffect(() => () => cleanup.current?.(), []);
  const buy = (item: ShopItem) => {
    if (busy.current) return;
    busy.current = true;
    setPending(item.id);
    setReceipt(null);
    const requestId = String(sequence = Math.max(sequence + 1, Date.now()));
    const timer = window.setTimeout(() => {
      cleanup.current?.();
      busy.current = false;
      setPending(null);
      setReceipt({ requestId, id: item.id, ok: false, message: "The store did not reply. Check your wallet before trying again." });
    }, 6000);
    const remove = view.buyItem({ id: item.id, requestId }, (result) => {
      cleanup.current?.();
      busy.current = false;
      setPending(null);
      setReceipt(result);
    });
    cleanup.current = () => { window.clearTimeout(timer); remove(); };
  };
  return (
    <>
      <p className="ph-note">Campus mini-mart. Purchases are eaten or drunk straight away.</p>
      <div className="ph-vitals"><span>Food <b>{live.food}%</b></span><span>Energy <b>{live.energy}%</b></span></div>
      {vitalityMessage(live) && <p className="ph-hunger" role="status">{vitalityMessage(live)}</p>}
      <div role="status">{receipt && <p className={receipt.ok ? "ph-success" : "ph-error"}>{receipt.message}</p>}</div>
      <ul className="ph-list ph-market">
        {SHOP_ITEMS.map((item) => {
          const full = (item.category === "food" ? live.food : live.energy) >= 100;
          const short = live.cash < item.price;
          return (
            <li key={item.id} className="ph-market-item">
              {item.image ? <Image src={item.image} alt="" width={450} height={300} className="ph-food-photo" unoptimized /> : <span className={`ph-drink ph-drink-${item.id}`} aria-hidden="true">{item.id === "coffee" ? <PiCoffeeFill /> : <PiDropFill />}</span>}
              <div className="ph-market-text"><b>{item.name}</b><small>{item.detail}</small><span className="ph-restore"><PiForkKnifeFill aria-hidden="true" /> +{item.food} food · +{item.energy} energy</span></div>
              <button type="button" className="ph-btn" disabled={!!pending || short || full} aria-busy={pending === item.id || undefined} aria-label={`Buy ${item.name} for ${naira(item.price)}${short ? ", not enough money" : full ? ", already full" : ""}`} onClick={() => buy(item)}>{pending === item.id ? "Paying…" : full ? "Full" : naira(item.price)}</button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
