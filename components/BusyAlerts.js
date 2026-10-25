// components/BusyAlerts.js
// "A lot of people are at SUB right now." Shown once, about 2 seconds after the player enters the game, and only when the server says a place really is busy.
// It is mounted by the Shell only while a character is loaded, so it starts when the game is entered and stops when the player logs out; moving between
// screens or apps never remounts it. It uses the game's own toast (lib/toast.js) and its action button takes the player to that place on the map.
"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { call } from "@/lib/client";
import { toast } from "@/lib/toast";
import { BUSY_ALERT, busyMessage, chooseAlert, readHistory, recordAlert, writeHistory } from "@/lib/busyAlert.js";

export default function BusyAlerts({ characterId }) {
  const router = useRouter(), path = usePathname(), pathRef = useRef(path), routerRef = useRef(router);
  pathRef.current = path; routerRef.current = router;

  useEffect(() => {
    if (!characterId) return undefined;
    let alive = true, asking = false, firstDone = false, timer = 0;
    const store = (() => { try { return window.sessionStorage; } catch { return null; } })();
    let history = readHistory(store, characterId);
    firstDone = history.count > 0; // a page reload in the same visit does not count as entering the game again

    const open = (id) => {
      // On the map the map page is told directly; from anywhere else the map opens already pointing at the place (the same ?to= link the OAU Guide uses).
      if (pathRef.current === "/map") window.dispatchEvent(new CustomEvent("oau:goto", { detail: { to: id } }));
      else routerRef.current.push(`/map?to=${encodeURIComponent(id)}`);
    };

    const check = async () => {
      if (!alive || asking) return;
      if (document.hidden) return; // nobody is looking: try again when the tab is back (see below) or at the next check
      asking = true;
      try {
        const r = await call("/api/travel?busy=1", undefined, { retries: 0 });
        if (!alive || r.failed) return; // offline, signed out, or the server could not say: say nothing, never guess
        history = readHistory(store, characterId);
        const pick = chooseAlert(r.places, history);
        if (!pick) return;
        const text = busyMessage(pick);
        if (!text) return;
        history = recordAlert(history, pick.id); writeHistory(store, history);
        toast.info(text, { id: "busy-place", duration: BUSY_ALERT.durationMs, action: { label: "Show on map", onClick: () => open(pick.id), whole: true } });
      } finally { asking = false; firstDone = true; }
    };

    // the first look, a moment after the game opens (cleaned up below if the player leaves first)
    timer = window.setTimeout(check, BUSY_ALERT.delayMs);
    // a tab opened in the background gets its first look when it comes to the front, not before
    const visible = () => { if (!document.hidden && !firstDone && alive) { window.clearTimeout(timer); timer = window.setTimeout(check, BUSY_ALERT.delayMs); } };
    document.addEventListener("visibilitychange", visible);
    // later looks are rare: a visible tab, every few minutes, and the rules above decide whether there is anything new worth saying
    const again = window.setInterval(check, BUSY_ALERT.recheckMs);
    return () => { alive = false; window.clearTimeout(timer); window.clearInterval(again); document.removeEventListener("visibilitychange", visible); toast.dismiss("busy-place"); };
  }, [characterId]);

  return null;
}
