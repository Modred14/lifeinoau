// lib/occupancyClient.js
// The building head counts for React screens. The feed itself is lib/occupancyFeed.js; this file hands it the real socket (lib/chat.js) and the page's visibility.
//   const n = useOccupancy("oduduwa");   // players inside that building right now; 0 when nobody (then nothing is drawn)
// A component that reads ONE building only redraws when THAT building's number changes (the selector returns a number, and React skips an unchanged one).
import { useSyncExternalStore } from "react";
import { occLink } from "@/lib/chat";
import { onReset } from "@/lib/optimistic";
import { createOccupancyFeed } from "./occupancyFeed.js";

export const occupancy = createOccupancyFeed({ link: occLink });

if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden) occupancy.poke(); });
onReset(() => occupancy.reset()); // signed out

export const useOccupancy = (id) => useSyncExternalStore(occupancy.subscribe, () => occupancy.count(id), () => 0);
