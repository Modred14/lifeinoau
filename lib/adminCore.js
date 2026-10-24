// lib/adminCore.js
// The foundation every administrator operation stands on. No imports from Next, no globals: it runs the same in the website and in a Node test.
//
//   AdminError     a refusal the administrator should read (status 4xx).
//   parseKobo      an amount typed by a person -> exact BigInt kobo. It never rounds, never truncates and has NO ceiling of its own: the only limit is
//                  what a Postgres bigint can hold, and that is checked against the real balance before anything is written.
//   runAdminOp     one administrator operation: the change and its audit row in ONE transaction, a repeated request id answered as a duplicate
//                  without a second change, and a FAILED audit row kept (outside the rolled back transaction) so the failure can be investigated.
//   jsonSafe       BigInt-safe JSON, so a balance of any size reaches the screen as exact text.
import { cleanText } from "./rules.js";

export class AdminError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** The largest value a Postgres bigint (every balance and ledger amount) can hold, in kobo. This is the data type's own limit, not a rule of the game. */
export const INT64_MAX = 9223372036854775807n;

export const REQUEST_ID = /^[\w:-]{8,128}$/;

/** "1,500,000", "₦ 2500.50", "10000000000000" -> exact kobo as BigInt. Numbers are accepted only while they are exact (a JSON number past 2^53 has already lost digits). */
export function parseKobo(input, { allowZero = false, what = "Amount" } = {}) {
  let s;
  if (typeof input === "bigint") s = input.toString();
  else if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw new AdminError(`${what} must be a positive number.`);
    if (!Number.isSafeInteger(Math.trunc(input)) || input > Number.MAX_SAFE_INTEGER) throw new AdminError(`${what} is too large to send as a number. Send it as text so no digit is lost.`);
    s = String(input);
    if (/e/i.test(s)) throw new AdminError(`${what} must be written out in full, without an exponent.`);
  } else s = String(input ?? "");
  s = s.trim().replace(/^₦\s*/, "").replace(/[,\s_]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new AdminError(`${what} must be a number such as 5000000 or 2500.50.`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 2) throw new AdminError(`${what} cannot have more than two decimal places (kobo is the smallest unit). Nothing is rounded.`);
  const kobo = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0") || "0");
  if (kobo === 0n && !allowZero) throw new AdminError(`${what} must be greater than zero.`);
  if (kobo > INT64_MAX) throw new AdminError(`${what} is larger than the database can store (${formatKobo(INT64_MAX)}).`);
  return kobo;
}

/** Code that already holds exact kobo (not something a person typed) is validated here: a whole BigInt, positive, within what a bigint column can store. */
export function exactKobo(v, { allowZero = false, what = "Amount" } = {}) {
  let k;
  try { k = BigInt(v); } catch { throw new AdminError(`${what} is not a whole number of kobo.`); }
  if (k < 0n || (k === 0n && !allowZero)) throw new AdminError(`${what} must be greater than zero.`);
  if (k > INT64_MAX) throw new AdminError(`${what} is larger than the database can store.`);
  return k;
}

/** Exact text for kobo of any size: "₦1,234,567.50" (the decimals only when there are kobo). */
export function formatKobo(kobo) {
  const v = BigInt(kobo ?? 0), neg = v < 0n, a = neg ? -v : v, whole = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), k = a % 100n;
  return `${neg ? "-" : ""}₦${whole}${k ? "." + String(k).padStart(2, "0") : ""}`;
}

/** Everything the dashboard sends back goes through here: BigInt and Decimal become exact text, dates become ISO strings. */
export const jsonSafe = (v) => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Query-string values are text, and are never trusted. */
export const str = (v, max = 200) => cleanText(Array.isArray(v) ? v[0] : v, max);
export const int = (v, { min = -Infinity, max = Infinity, fallback = null } = {}) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
export const oneOf = (v, list, fallback = null) => { const s = str(v, 40); return list.includes(s) ? s : fallback; };
export const dateOf = (v) => { const s = str(v, 40); if (!s) return null; const d = new Date(s); return Number.isNaN(+d) ? null : d; };
export const page = (q, { size = 25, maxSize = 100 } = {}) => {
  const pageSize = int(q.pageSize, { min: 1, max: maxSize, fallback: size }), p = int(q.page, { min: 1, max: 1_000_000, fallback: 1 });
  return { page: p, pageSize, offset: (p - 1) * pageSize };
};

/** A reason is required for anything consequential: it is shown to the next administrator reading the log. */
export function reasonOf(v, { min = 10, max = 300, what = "A clear reason" } = {}) {
  const t = cleanText(v, max);
  if (t.length < min) throw new AdminError(`${what} (${min}+ characters) is required.`);
  return t;
}

export const writeAudit = (db, actorId, action, target, detail, extra = {}) =>
  db.auditLog.create({ data: { actorId, action, target: target ?? null, detail: detail ?? null, status: "OK", requestId: extra.requestId ?? null } });

/**
 * One administrator operation.
 *   op = { action, target?, requestId?, detail? }          (`detail` is only used for the FAILED row)
 *   fn(tx) -> { result?, detail?, target? }                 the change itself, run inside the transaction
 * A request id that has already succeeded for this administrator returns { ok: true, duplicate: true } and changes nothing, including when two
 * identical requests arrive together (the partial unique index on the audit log lets only one of them commit).
 */
export async function runAdminOp(db, adminId, op, fn) {
  const { action, requestId = null } = op;
  if (requestId != null && !REQUEST_ID.test(requestId)) throw new AdminError("Missing or invalid requestId.");
  try {
    return await db.$transaction(async (tx) => {
      if (requestId && (await tx.auditLog.findFirst({ where: { actorId: adminId, requestId, status: "OK" }, select: { id: true } }))) return { ok: true, duplicate: true };
      const out = (await fn(tx)) ?? {};
      await tx.auditLog.create({ data: { actorId: adminId, action, target: out.target ?? op.target ?? null, detail: out.detail ?? null, status: "OK", requestId } });
      return { ok: true, ...(out.result ?? {}) };
    });
  } catch (e) {
    if (e?.code === "P2002" && requestId) return { ok: true, duplicate: true }; // an identical request committed first
    try {
      await db.auditLog.create({ data: { actorId: adminId, action, target: op.target ?? null, detail: op.detail ?? null, status: "FAILED", requestId, error: String(e?.message ?? e).slice(0, 300) } });
    } catch { /* the failure record is best effort: never hide the real error behind it */ }
    throw e;
  }
}

/** Page of rows plus the paging facts every table needs. */
export const paged = (rows, total, p) => ({ rows, total: Number(total), page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(Number(total) / p.pageSize)) });

/** A short id other players see for a character (the same one lib/playerPresence.js uses). */
export const publicId = (id) => String(id).slice(-8);

/** CSV that spreadsheets cannot be tricked by: values that start with = + - @ are neutralised, quotes are doubled. */
export function csv(headers, rows) {
  const cell = (v) => {
    let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
