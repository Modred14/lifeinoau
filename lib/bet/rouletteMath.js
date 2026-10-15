// lib/bet/rouletteMath.js
// European roulette: one zero, 37 pockets, house edge 2.70%. PURE: the browser draws the table, the server settles the spin.
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
export const MIN_CHIP = 100, MAX_STAKE = 500_000, MAX_BETS = 40;

// the table is 12 rows of 3: row r (0..11) holds 3r+1, 3r+2, 3r+3. column c (0..2) is the numbers n with (n-1)%3 === c.
const rows = (a, b) => { const o = []; for (let n = a; n <= b; n++) o.push(n); return o; };
/** What a bet covers and what it pays (to 1). Returns null for anything that is not a legal bet on the table. */
export function coverage(b) {
  const r = Number(b?.ref), t = b?.type;
  const int = Number.isInteger(r);
  switch (t) {
    case "straight": return int && r >= 0 && r <= 36 ? { nums: [r], pays: 35 } : null;
    case "split": { // ref = "a-b": two numbers that touch on the table (0 touches 1, 2 and 3)
      const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(b.ref)); if (!m) return null;
      const a = Number(m[1]), c = Number(m[2]); if (a >= c || c > 36) return null;
      const ok = a === 0 ? c <= 3 : c - a === 3 || (c - a === 1 && (a - 1) % 3 !== 2);
      return ok ? { nums: [a, c], pays: 17 } : null;
    }
    case "street": return int && r >= 1 && r <= 34 && (r - 1) % 3 === 0 ? { nums: [r, r + 1, r + 2], pays: 11 } : null;
    case "corner": return int && r >= 1 && r <= 32 && (r - 1) % 3 !== 2 ? { nums: [r, r + 1, r + 3, r + 4], pays: 8 } : null; // r = the smallest number of the four
    case "column": return int && r >= 1 && r <= 3 ? { nums: rows(1, 36).filter((n) => (n - 1) % 3 === r - 1), pays: 2 } : null;
    case "dozen": return int && r >= 1 && r <= 3 ? { nums: rows((r - 1) * 12 + 1, r * 12), pays: 2 } : null;
    case "even": { // red/black/odd/even/low/high, ref is the name
      const f = { red: (n) => REDS.has(n), black: (n) => n > 0 && !REDS.has(n), odd: (n) => n % 2 === 1, even: (n) => n > 0 && n % 2 === 0, low: (n) => n >= 1 && n <= 18, high: (n) => n >= 19 };
      const g = f[b.ref]; return g ? { nums: rows(0, 36).filter(g), pays: 1 } : null;
    }
    case "trio": return b.ref === "0-1-2" ? { nums: [0, 1, 2], pays: 11 } : b.ref === "0-2-3" ? { nums: [0, 2, 3], pays: 11 } : null;
    default: return null;
  }
}
export const betKey = (b) => `${b.type}:${b.ref}`;

/** Settle a spin. bets = [{ type, ref, chip (kobo) }]. Returns the total staked and the total paid back (stake included on a win). */
export function settle(bets, number) {
  let staked = 0n, paid = 0n; const wins = [];
  for (const b of bets) {
    const c = coverage(b), chip = BigInt(b.chip); staked += chip;
    if (c.nums.includes(number)) { const back = chip * BigInt(c.pays + 1); paid += back; wins.push(betKey(b)); }
  }
  return { staked, paid, wins };
}