// lib/marketClient.js
// The live market for React screens. The feed itself is lib/marketFeed.js; this file hands it the real socket (lib/chat.js), the real HTTP caller
// and the page's visibility.  const m = useMarket();  m.prices.INDEX, m.changes.INDEX.m5, m.series.INDEX.values, m.link ("live" | "polling" | "offline")
import { useEffect, useSyncExternalStore } from "react";
import { call } from "@/lib/client";
import { marketLink } from "@/lib/chat";
import { createMarketFeed } from "./marketFeed.js";

export const marketFeed = createMarketFeed({
  link: marketLink,
  load: (range) => call("/api/invest/live?range=" + encodeURIComponent(range)),
  visible: () => typeof document === "undefined" || !document.hidden,
});

/** The live state; keeps the feed running while the component is on screen. */
export function useMarket() {
  useEffect(() => marketFeed.acquire(), []);
  return useSyncExternalStore(marketFeed.subscribe, marketFeed.getState, marketFeed.getState);
}
export const setMarketRange = (r) => marketFeed.setRange(r);
