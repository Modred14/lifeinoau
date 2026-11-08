// lib/games/gamesClient.js: small helpers the Games app and its boards share (browser side; no secrets, nothing here decides a result).
import { compactMoney, compactKobo } from "@/lib/money.js";
import { call } from "@/lib/client";

/** A fresh id for one request: the server plays a request with the same id once, so a repeated send is harmless. */
export const rid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
/** POST one games request. Resolves { ...answer, failed, error }, never throws (see lib/client.js). */
export const gamesPost = (op, body = {}, opts) => call("/api/games", { requestId: rid(), ...body, op }, opts); // `op` is last: nothing in a body can change which request this is;
export const gamesGet = (query = "", opts) => call("/api/games" + (query ? "?" + query : ""), undefined, opts);

/** "₦1.00k" from naira. */
export const nairaOf = (n) => compactMoney(n);
/** "₦1.00k" from kobo (a string or number). */
export const koboNaira = (k) => compactKobo(k);
/** "m:ss" from milliseconds. */
export const clockText = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
/** The name of a seat as the player sees it ("You" for their own). */
export const seatName = (m, seat) => (seat === m.seat ? m.you.name : m.opponent.name);
/** What the finished match means for the player, in words: [headline, tone]. */
export function outcomeText(m) {
  switch (m.outcome) {
    case "WON": return ["You won!", "win"];
    case "LOST": return ["You lost", "lose"];
    case "DRAW": return ["Draw", "draw"];
    case "VOID": return ["Match cancelled", "draw"];
    default: return ["Match over", "draw"];
  }
}
