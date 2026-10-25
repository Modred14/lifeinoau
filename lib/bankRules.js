// lib/bankRules.js
// Pure rules for the Bank app: no database, no I/O, safe to import in the browser. Money is kobo, always BigInt, never a float.
// The server (lib/bankService.js) enforces every one of these; the screens only read them to explain what will happen.

export const BANK = {
  minNaira: 100, // smallest amount moved into or out of savings
  maxNaira: 1_000_000_000, // largest single move
  maxGoals: 5, // open goals (active or achieved) at a time
  goalMinNaira: 1_000,
  goalMaxNaira: 1_000_000_000,
  nameMax: 30,
  historyPage: 30,
};

const K = (n) => BigInt(n) * 100n;
export const toKobo = K;

/** A whole number of naira between min and max, or { error }. Strings of digits are accepted (inputs send strings); anything else is refused. */
export function parseNaira(v, { min = BANK.minNaira, max = BANK.maxNaira, what = "amount" } = {}) {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,12}$/.test(s)) return { error: `Enter a whole ${what} in naira.` };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < min || n > max) return { error: `The ${what} must be between ₦${min.toLocaleString("en-NG")} and ₦${max.toLocaleString("en-NG")}.` };
  return { n };
}

/** A goal name: control characters removed, spaces collapsed, 1 to 30 characters. */
export function cleanGoalName(s) {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, BANK.nameMax);
  return t.length ? t : null;
}

const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };

/**
 * THE net worth. Cash + savings + business capital + investments, each counted once:
 *  - cash is the spendable wallet (Account.balance); savings is held apart in the SAVINGS account, so moving money into savings never changes net worth;
 *  - business capital and investments are held by the BUSINESS and MARKET accounts, never in the wallet;
 *  - savings goals are NOT added: they only set aside part of the savings balance;
 *  - cars and clothes are not counted (they cannot be sold back, so counting what was paid would just undo the spending).
 * The profile, the FORBES board and the Bank app all use this definition (the board does it in SQL, with the same four parts).
 */
export function netWorthOf({ cash = 0n, savings = 0n, business = 0n, investments = 0n } = {}) {
  const p = { cash: big(cash), savings: big(savings), business: big(business), investments: big(investments) };
  for (const k of Object.keys(p)) if (p[k] < 0n) p[k] = 0n; // a negative part is never drawn or counted
  return { ...p, total: p.cash + p.savings + p.business + p.investments };
}

/** How much of the savings is set aside for goals, and how much is free to withdraw or set aside. Goals are { savedKobo, status }. */
export function splitSavings(balance, goals = []) {
  const bal = big(balance);
  const earmarked = goals.filter((g) => g.status !== "CLOSED").reduce((t, g) => t + big(g.savedKobo), 0n);
  return { balance: bal, earmarked, free: bal > earmarked ? bal - earmarked : 0n };
}

/** Percent of a goal reached, 0 to 100, whole numbers (rounded down: 99.9% shows 99). */
export function goalPct(g) {
  const t = big(g?.targetKobo);
  if (t <= 0n) return 0;
  const p = (big(g.savedKobo) * 100n) / t;
  return Number(p > 100n ? 100n : p);
}

/** A stable 10 digit account number for a player (it is shown on the card, it is not a secret and is not used to move money). */
export function accountNumber(characterId) {
  let h1 = 2166136261, h2 = 5381;
  for (const ch of String(characterId)) { h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0; h2 = (Math.imul(h2, 33) ^ ch.charCodeAt(0)) >>> 0; }
  const n = (BigInt(h1) * 4294967296n + BigInt(h2)) % 10_000_000_000n;
  return n.toString().padStart(10, "0");
}
export const CARD_TIER = { LAPO: "Classic", MAPO: "Gold", NEPO: "Platinum" };
export const cardTierOf = (cls) => CARD_TIER[cls] ?? "Classic";

/** "Sent to Ada" / note split: ledger memos for player transfers look like "To Ada: for food". */
const afterColon = (memo) => { const i = String(memo).indexOf(": "); return i < 0 ? null : String(memo).slice(i + 2).trim() || null; };

/**
 * Turn one ledger row into a line of the statement, from the point of view of the account `mineId`.
 * entry: { id, amount, memo, idempotencyKey, debitAccountId, creditAccountId, createdAt }
 * other: the account on the other side: { id, systemName, character: { name } | null } (or null when unknown).
 * Returns { id, at, amountKobo, direction: "in" | "out", category, title, detail, counterparty }.
 */
export function describeEntry(entry, mineId, other) {
  const out = entry.debitAccountId === mineId, key = String(entry.idempotencyKey ?? ""), memo = String(entry.memo ?? "");
  const who = other?.character?.name ?? null, sys = other?.systemName ?? null;
  const base = { id: String(entry.id), at: entry.createdAt, amountKobo: big(entry.amount).toString(), direction: out ? "out" : "in", counterparty: who ?? sys };
  if (sys === "SAVINGS") return { ...base, category: "savings", title: out ? "Moved to savings" : "Withdrawn from savings", detail: null };
  if (key.startsWith("p2p:")) {
    const note = afterColon(memo);
    return { ...base, category: "transfer", title: out ? `Sent to ${who ?? memo.replace(/^To /, "").split(":")[0]}` : `Received from ${who ?? "a player"}`, detail: note };
  }
  if (key.startsWith("fee:") || key.startsWith("invfee:")) return { ...base, category: "fee", title: memo || "Fee", detail: null };
  if (memo === "Weekly allowance") return { ...base, category: "family", title: "Weekly allowance", detail: "From home" };
  if (memo === "Gift from parent") return { ...base, category: "family", title: "Gift from your parent", detail: null };
  return { ...base, category: out ? "spending" : "income", title: memo || (out ? "Payment" : "Money received"), detail: null };
}

/** The statement filters the app offers. `savingsId` is the id of the SAVINGS system account (needed for the "savings" filter). */
export const HISTORY_FILTERS = ["all", "in", "out", "savings", "transfers"];
