"use client";

import { useEffect, useState } from "react";
import { PHONE_PURCHASE_TIMEOUT_MS } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";

export type Purchase = { status: "idle" } | { status: "pending" | "failed" | "done"; id: string };

const IDLE: Purchase = { status: "idle" };

export function usePurchase(view: CampusView, currentId: string): { purchase: Purchase; buy: (id: string) => void } {
  const [purchase, setPurchase] = useState<Purchase>(IDLE);

  useEffect(() => {
    if (purchase.status !== "pending") return;
    if (purchase.id === currentId) {
      setPurchase({ status: "done", id: purchase.id });
      return;
    }
    const timer = window.setTimeout(() => setPurchase({ status: "failed", id: purchase.id }), PHONE_PURCHASE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [purchase, currentId]);

  const buy = (id: string) => {
    if (purchase.status === "pending") return;
    view.buyPhone(id);
    setPurchase({ status: "pending", id });
  };

  return { purchase, buy };
}
