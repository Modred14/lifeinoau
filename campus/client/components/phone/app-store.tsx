"use client";

import { useRef, useState } from "react";
import { PHONES, findPhone, type Phone } from "@campuslife/shared";
import { PiCheckCircleFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import { naira } from "./format";
import { StoreItem } from "./store-item";
import { StoreSheet } from "./store-sheet";
import { usePurchase } from "./use-purchase";
import { AppMarket } from "./app-market";
import type { PhoneLive } from "./use-phone-live";

export function AppStore({ view, phone, cash, live }: { view: CampusView; phone: Phone; cash: number; live: PhoneLive }) {
  const { purchase, buy } = usePurchase(view, phone.id);
  const [picked, setPicked] = useState<Phone | null>(null);
  const [section, setSection] = useState<"phones" | "market">("phones");
  const list = useRef<HTMLUListElement>(null);
  const bought = purchase.status === "done" ? findPhone(purchase.id) : undefined;
  const closeSheet = () => {
    setPicked(null);
    list.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  };
  return (
    <>
      <div className="ph-shop-balance"><span>Wallet balance</span><b>{naira(cash)}</b></div>
      <div className="ph-store-switch" role="group" aria-label="Stores">
        <button type="button" disabled={!!picked || purchase.status === "pending"} aria-pressed={section === "phones"} onClick={() => setSection("phones")}>Phone shop</button>
        <button type="button" disabled={!!picked || purchase.status === "pending"} aria-pressed={section === "market"} onClick={() => setSection("market")}>Food & drinks</button>
      </div>
      {section === "market" ? <AppMarket view={view} live={live} /> : <>
      <p className="ph-note">Game prices. A new phone replaces the one you use now.</p>
      <div role="status">
        {bought && (
          <p className="ph-success">
            <PiCheckCircleFill aria-hidden="true" />
            You now use the {bought.name}.
          </p>
        )}
      </div>
      <ul className="ph-list ph-store" ref={list} inert={!!picked}>
        {PHONES.map((item) => (
          <StoreItem key={item.id} phone={item} current={item.id === phone.id} cash={cash} purchase={purchase} onPick={setPicked} />
        ))}
      </ul>
      {picked && (
        <StoreSheet
          phone={picked}
          current={phone}
          cash={cash}
          onCancel={closeSheet}
          onConfirm={() => {
            buy(picked.id);
            closeSheet();
          }}
        />
      )}
      </>}
    </>
  );
}
