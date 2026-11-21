// lib/populationClient.js
// The header's campus population for React screens. The feed itself is lib/populationFeed.js; this file hands it the real socket (lib/chat.js), the real HTTP
// calls and the page's visibility.   const people = usePopulation();   // a number, or null until the server has said
import { useEffect, useSyncExternalStore } from "react";
import { call } from "@/lib/client";
import { popLink } from "@/lib/chat";
import { createPopulationFeed, createEntryReporter } from "./populationFeed.js";

export const populationFeed = createPopulationFeed({
  link: popLink,
  load: () => call("/api/population", undefined, { retries: 0 }),
  visible: () => typeof document === "undefined" || !document.hidden,
});

const store = {
  get: (k) => window.sessionStorage.getItem(k),
  set: (k, v) => window.sessionStorage.setItem(k, v),
};
/** report(characterId): the player has entered the game (once per tab visit). The server decides whether it counts and answers with the new total. */
export const reportEntry = createEntryReporter({
  post: () => call("/api/population", {}, { retries: 0 }),
  store,
  onAnswer: (r) => populationFeed.apply(r),
});

/** The people on campus now; keeps the feed running while the component is on screen. */
export function usePopulation() {
  useEffect(() => populationFeed.acquire(), []);
  return useSyncExternalStore(populationFeed.subscribe, populationFeed.people, () => null);
}
