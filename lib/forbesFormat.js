// lib/forbesFormat.js
// Pure helpers for the FORBES OAU screen (components/apps/ForbesBoard.js). Money is kobo, always handled as BigInt, never as a float.
const TIERS = [[10n ** 12n, "tn"], [10n ** 9n, "bn"], [10n ** 6n, "m"]];
const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };

/** Short money for tight places: 120000000000000 kobo -> "₦1.2tn", 10000000000000 -> "₦100bn", 4500000 -> "₦45,000". Rounds down, never up. */
export function compactNaira(kobo) {
  const k = big(kobo), neg = k < 0n, n = (neg ? -k : k) / 100n, sign = neg ? "-" : "";
  for (const [div, suffix] of TIERS) {
    if (n >= div) {
      const tenths = (n * 10n) / div, frac = tenths % 10n;
      return `${sign}₦${(tenths / 10n).toLocaleString("en-NG")}${frac ? "." + frac : ""}${suffix}`;
    }
  }
  return `${sign}₦${n.toLocaleString("en-NG")}`;
}

/** What a fortune is made of: [{ key, kobo, pct }] for cash, business and investments (pct to one decimal), or null when there is nothing to split. */
export function wealthShares(row) {
  const parts = [["cash", row?.cash], ["business", row?.business], ["investments", row?.investments]].map(([key, v]) => [key, big(v) > 0n ? big(v) : 0n]);
  const total = parts.reduce((s, [, v]) => s + v, 0n);
  if (total === 0n) return null;
  return parts.map(([key, v]) => ({ key, kobo: v.toString(), pct: Number((v * 1000n) / total) / 10 }));
}

/** The first three rows in podium order (2nd, 1st, 3rd); a place nobody holds yet is null. `place` is the position, the row's own `rank` stays as the server ranked it (ties share a rank). */
export const podiumSlots = (rows) => [1, 0, 2].map((i) => (rows?.[i] ? { row: rows[i], place: i + 1 } : null));

export const sameName = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
