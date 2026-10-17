"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OPEN_ORDER_STATUSES, type MarketSummary } from "@campuslife/shared/market";
import { getMarketSummary, marketErrorMessage } from "@campus/lib/api/market";

const POLL_MS = 15_000;

export interface Market {
  summary: MarketSummary | null;
  error: string | null;
  openCount: number;
  refresh: () => Promise<void>;
}

/** The signed-in student's real orders and the delivery fee, refreshed while an order is on its way. */
export function useMarket(): Market {
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getMarketSummary();
      if (!alive.current) return;
      setSummary(next);
      setError(null);
    } catch (err) {
      if (alive.current) setError(marketErrorMessage(err));
    }
  }, []);

  const openCount = summary?.orders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status)).length ?? 0;

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!openCount) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [openCount, refresh]);

  return { summary, error, openCount, refresh };
}
