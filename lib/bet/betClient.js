// lib/bet/betClient.js  (browser side of the Bet app)
// Shared stores: the player's slips and the live scores (both use the show-first / undo-if-refused store), the slip being built,
// the server's clock, and a wallet that can be held back while a roulette ball is still rolling so the result is never spoiled.
import { useEffect, useState, useSyncExternalStore } from "react";
import { call } from "@/lib/client";
import { createStore } from "@/lib/optimistic";
import { game, useGame } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { playSound, playReel } from "@/lib/sound";
import { oddsFor } from "./markets.js";
import { MAX_LEGS } from "./markets.js";

// ---- the server's clock: fixtures are built from time alone, so a wrong phone clock must be corrected ----
let offset = 0;
export const setServerNow = (ms) => { if (Number.isFinite(ms)) offset = ms - Date.now(); };
export const nowMs = () => Date.now() + offset;
/** Re-renders every `ms` and returns the server-corrected time. */
export function useNow(ms = 1000) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => !document.hidden && tick((x) => x + 1), ms); return () => clearInterval(t); }, [ms]);
  return nowMs();
}

// ---- live scores ----
export const liveStore = createStore(async () => { const r = await call("/api/bet/live"); if (!r.failed) setServerNow(r.now); return r; });

// ---- the player's slips; slips that settled while the app was open announce themselves here ----
export const slipsStore = createStore(async () => {
  const r = await call("/api/bet/slips");
  if (!r.failed) {
    setServerNow(r.now);
    for (const x of r.settled ?? []) {
      if (x.status === "WON") { toast.success(`Your slip won ₦${(BigInt(x.payoutKobo) / 100n).toLocaleString("en-NG")}.`, { sound: "coin" }); }
      else toast.info("A slip lost. Better luck on the next one.", { sound: "warn" });
    }
    if (r.settled?.length) game.scheduleRefresh();
  }
  return r;
});

// ---- the slip being built (survives switching tabs) ----
let slip = { legs: [], stake: 1000, open: false };
const subs = new Set();
const set = (patch) => { slip = { ...slip, ...patch }; subs.forEach((f) => f()); };
export const builder = {
  get: () => slip,
  subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  /** Add a pick, take it away if it is already there, or swap it if another pick on the same match is on the slip. */
  toggle(fx, mk, pk) {
    const same = slip.legs.find((l) => l.fx === fx.id && l.mk === mk && l.pk === pk);
    if (same) return set({ legs: slip.legs.filter((l) => l !== same) });
    const odds = oddsFor(fx, mk, pk); if (!odds) return;
    const leg = { fx: fx.id, mk, pk, odds, home: fx.home, away: fx.away, leagueName: fx.leagueName, ko: fx.ko };
    const rest = slip.legs.filter((l) => l.fx !== fx.id);
    if (rest.length >= MAX_LEGS) return toast.error(`A slip can hold up to ${MAX_LEGS} matches.`, { id: "maxlegs" });
    set({ legs: [...rest, leg] });
  },
  remove: (fxId) => set({ legs: slip.legs.filter((l) => l.fx !== fxId) }),
  clear: () => set({ legs: [] }),
  setStake: (n) => set({ stake: n }),
  open: (v) => set({ open: v }),
  restore: (legs, stake) => set({ legs, stake, open: true }),
};
export const useBuilder = () => useSyncExternalStore(builder.subscribe, builder.get, () => slip);

// ---- wallet shown in the Bet app: the real balance, unless a result is being held back ----
let held = null; const wsubs = new Set();
export const holdWallet = (kobo) => { held = kobo.toString(); wsubs.forEach((f) => f()); };
export const releaseWallet = () => { held = null; wsubs.forEach((f) => f()); };
export function useWallet() {
  const g = useGame(), h = useSyncExternalStore((f) => { wsubs.add(f); return () => wsubs.delete(f); }, () => held, () => null);
  return h ?? g?.balanceKobo ?? "0";
}

// ---- small formatters ----
export const money = (n) => "₦" + Number(n).toLocaleString("en-NG");
export const moneyK = (kobo) => "₦" + (BigInt(kobo) / 100n).toLocaleString("en-NG");
export const odd = (hundredths) => (hundredths / 100).toFixed(2);
export const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", hour12: false });
export const countdown = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const short = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
/** A pick in plain words: "Northgate United", "Over 2.5", "GG". */
export function pickLabel(l) {
  if (l.mk === "1x2") return l.pk === "h" ? l.home : l.pk === "a" ? l.away : "Draw";
  if (l.mk === "dc") return l.pk === "hd" ? `${l.home} or draw` : l.pk === "da" ? `Draw or ${l.away}` : `${l.home} or ${l.away}`;
  if (l.mk.startsWith("ou")) return `${l.pk === "o" ? "Over" : "Under"} ${l.mk === "ou15" ? "1.5" : l.mk === "ou25" ? "2.5" : "3.5"}`;
  return l.pk === "y" ? "Both teams score" : "Not both teams score";
}
export { playSound, playReel };