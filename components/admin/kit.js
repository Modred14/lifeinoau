// components/admin/kit.js — the small set of building blocks every console screen is made from.
"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Warning, Tray, CaretUp, CaretDown, X } from "@phosphor-icons/react";
import { call } from "@/lib/client";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import PlayerAvatar from "@/components/PlayerAvatar";

// ------------------------------------------------------------------ formatting (money is BigInt text: never a float)
export function kobo(v, { sign = false } = {}) {
  if (v == null || v === "") return "—";
  let n; try { n = BigInt(String(v).split(".")[0]); } catch { return "—"; }
  const neg = n < 0n, a = neg ? -n : n, w = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), k = a % 100n;
  return `${neg ? "-" : sign ? "+" : ""}₦${w}${k ? "." + String(k).padStart(2, "0") : ""}`;
}
/** Short form for tight spots (cards, axes). The exact figure should be one click or hover away (title attribute). */
export function koboShort(v) {
  if (v == null) return "—";
  let n; try { n = BigInt(String(v).split(".")[0]); } catch { return "—"; }
  const neg = n < 0n, a = (neg ? -n : n) / 100n, units = [[10n ** 15n, "Q"], [10n ** 12n, "T"], [10n ** 9n, "B"], [10n ** 6n, "M"], [10n ** 3n, "K"]];
  for (const [u, s] of units) if (a >= u) { const t = (a * 100n) / u, whole = t / 100n, frac = String(t % 100n).padStart(2, "0").replace(/0$/, ""); return `${neg ? "-" : ""}₦${whole}${frac ? "." + frac : ""}${s}`; }
  return `${neg ? "-" : ""}₦${a.toString()}`;
}
export const int = (v) => (v == null ? "—" : Number(v).toLocaleString("en-NG"));
export const when = (d) => (d ? new Date(d).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const day = (d) => (d ? new Date(d).toLocaleDateString("en-NG", { dateStyle: "medium" }) : "—");
export function ago(d, now = Date.now()) {
  if (!d) return "never";
  const s = Math.max(0, Math.round((now - +new Date(d)) / 1000));
  if (s < 45) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 45) return `${Math.round(s / 86400)} d ago`; return day(d);
}
export const rid = () => "adm-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^\w-]/g, "");
/** One request id per intended action: kept across retries and failures, renewed only after the action succeeded or the form is reopened. */
export function useRid() { const [id, setId] = useState(rid); return [id, useCallback(() => setId(rid()), [])]; }

// ------------------------------------------------------------------ api
export const qs = (o = {}) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== "" && v != null && v !== false) p.set(k, String(v)); const s = p.toString(); return s ? "?" + s : ""; };
const base = "/api/admin/console/";
export const get = (path, params) => call(base + path + qs(params));
export const post = (path, body, opts) => call(base + path, body, opts);

/** Load data; keeps the previous answer on screen while a new one loads (no flicker), ignores answers that arrive late, optional polling. */
export function useApi(path, params = {}, { every = 0, skip = false } = {}) {
  const key = path + qs(params), [st, setSt] = useState({ data: null, error: null, loading: !skip, at: null }), seq = useRef(0), alive = useRef(true);
  const load = useCallback(async (quiet = false) => {
    if (skip) return; const my = ++seq.current;
    if (!quiet) setSt((s) => ({ ...s, loading: true }));
    const r = await get(path, params);
    if (!alive.current || my !== seq.current) return;
    if (r.failed) setSt((s) => ({ data: s.data, error: r, loading: false, at: s.at }));
    else setSt({ data: r, error: null, loading: false, at: Date.now() });
  }, [key, skip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!every || skip) return;
    const t = setInterval(() => !document.hidden && load(true), every), v = () => !document.hidden && load(true);
    document.addEventListener("visibilitychange", v); return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [every, load, skip]);
  return { ...st, reload: load };
}
/** Debounced copy of a value, for search boxes. */
export function useDebounced(v, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

/** Run a change. Shows a pending toast, then success/error; resolves the response. `rid` makes a retry safe (the server answers a repeat as a duplicate). */
const inflight = new Map(); // "path + exact content" -> request id. The same content always carries the same id until it has succeeded, so a retry can never apply twice;
//                             changed content gets a new id, so an edited request is never mistaken for the earlier one.
/** A request id for a whole multi-step operation (a chunked send). Same content -> same id until opDone(), so re-running it after a failure resumes instead of repeating. */
export const opId = (content) => { const key = "op:" + JSON.stringify(content); if (!inflight.has(key)) inflight.set(key, rid()); return inflight.get(key); };
export const opDone = (content) => inflight.delete("op:" + JSON.stringify(content));
export async function act(path, body, { pending = "Working…", success = "Done." } = {}) {
  const id = toast.pending(pending), key = path + JSON.stringify(body);
  if (!body.requestId) { if (!inflight.has(key)) inflight.set(key, rid()); body = { ...body, requestId: inflight.get(key) }; }
  const r = await post(path, body);
  if (!r.failed) inflight.delete(key);
  if (r.failed) { toast.error(r.error || "That did not go through.", { id, duration: 8000 }); return r; }
  toast.success(r.duplicate || r.replayed ? "That request had already been applied. Nothing was changed twice." : success, { id });
  return r;
}
export { confirmAction };

// ------------------------------------------------------------------ pieces
export function Badge({ tone = "", children, plain }) { return <span className={`badge ${tone} ${plain ? "plain" : ""}`}>{children}</span>; }
export const PRESENCE = { ONLINE: ["ok", "Online"], IDLE: ["warn", "Idle"], DISCONNECTED: ["bad", "Disconnected"], OFFLINE: ["", "Offline"] };
export const PresenceBadge = ({ v }) => { const [t, l] = PRESENCE[v] ?? ["", v]; return <Badge tone={t}>{l}</Badge>; };
export const STATUS = { ACTIVE: ["ok", "Active"], SUSPENDED: ["warn", "Suspended"], DELETED: ["bad", "Archived"] };
export const StatusBadge = ({ v }) => { const [t, l] = STATUS[v] ?? ["", v]; return <Badge tone={t}>{l}</Badge>; };

export function PageHead({ title, sub, children }) { return <div className="adm-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="adm-actions">{children}</div></div>; }
export function Card({ title, right, children, className = "" }) { return <section className={`card ${className}`}>{(title || right) && <header><h3>{title}</h3>{right}</header>}{children}</section>; }
export function Stat({ label, value, sub, tone, title }) { return <div className={`stat ${tone ?? ""}`} title={title}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>; }
export function Empty({ title = "Nothing here", children, icon }) { return <div className="empty">{icon ?? <Tray size={30} />}<b>{title}</b>{children && <span>{children}</span>}</div>; }
export function ErrorBox({ error, retry }) {
  return <div className="errbox" role="alert"><Warning size={30} /><b>{error?.status === 404 ? "Not available" : "Could not load this"}</b><span>{error?.error || "Check your connection and try again."}</span>{retry && <button className="btn" onClick={() => retry()}>Try again</button>}</div>;
}
export function Skeleton({ rows = 5 }) { return <div className="stack" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ height: 18, width: `${92 - (i % 3) * 14}%` }} />)}</div>; }
/** Handles the three states every data view has. */
export function Async({ q, empty, children, rows }) {
  if (q.error && !q.data) return <ErrorBox error={q.error} retry={q.reload} />;
  if (!q.data) return <Card><Skeleton rows={rows} /></Card>;
  return <>{q.error && <div className="note bad">Showing the last loaded data. Refreshing failed: {q.error.error || "network problem"} <button className="btn sm" onClick={() => q.reload()}>Retry</button></div>}{empty ? empty : children}</>;
}
export function Note({ tone = "", children }) { return <div className={`note ${tone}`}>{children}</div>; }
export function Spin() { return <span className="spin" aria-hidden="true" />; }
export function Btn({ busy, children, tone = "", size = "", ...p }) { return <button {...p} disabled={p.disabled || busy} className={`btn ${tone} ${size} ${p.className ?? ""}`}>{busy && <Spin />}{children}</button>; }

export function Field({ label, hint, error, children }) { const id = useId(); return <div className="field"><label htmlFor={id}>{label}</label>{typeof children === "function" ? children(id) : children}{error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}</div>; }
export function Input({ label, hint, error, ...p }) { return <Field label={label} hint={hint} error={error}>{(id) => <input id={id} className="inp" aria-invalid={!!error} {...p} />}</Field>; }
export function Select({ label, value, onChange, options, hint }) {
  return <Field label={label} hint={hint}>{(id) => <div className="selwrap"><select id={id} className="sel" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}</select></div>}</Field>;
}
export function Area({ label, hint, error, ...p }) { return <Field label={label} hint={hint} error={error}>{(id) => <textarea id={id} aria-invalid={!!error} {...p} />}</Field>; }
export function Seg({ value, onChange, options, label }) {
  return <div className="seg" role="group" aria-label={label}>{options.map((o) => { const [v, l, c] = Array.isArray(o) ? o : [o, o]; return <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}{c != null && <span className="c">{c}</span>}</button>; })}</div>;
}
export function Tabs({ value, onChange, options }) {
  return <div className="tabs" role="tablist">{options.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export function Search({ value, onChange, placeholder = "Search…", label = "Search" }) {
  return <div className="search grow"><MagnifyingGlass size={16} /><input className="inp" type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}
export function Person({ name, sub, look, size = 32 }) {
  return <div className="who"><PlayerAvatar name={name} size={size} look={look ?? null} /><div style={{ minWidth: 0 }}><b>{name ?? "No character yet"}</b>{sub && <small>{sub}</small>}</div></div>;
}

/** columns: [{ key, label, n?, sort?, render?(row), hide? }]. `sort` is the server's sort key. */
export function Table({ columns, rows, sort, dir, onSort, onRow, loading, rowKey, cards = true, empty }) {
  if (!rows.length) return empty ?? <Empty title="No results">Nothing matches these filters.</Empty>;
  return (
    <div className="tbl-wrap"><table className={`tbl ${loading ? "loading" : ""} ${cards ? "cards" : ""}`}>
      <thead><tr>{columns.map((c) => <th key={c.key} className={c.n ? "n" : ""} aria-sort={c.sort && sort === c.sort ? (dir === "asc" ? "ascending" : "descending") : undefined}>
        {c.sort && onSort ? <button onClick={() => onSort(c.sort, sort === c.sort && dir === "desc" ? "asc" : "desc")}>{c.label}{sort === c.sort && (dir === "asc" ? <CaretUp size={11} /> : <CaretDown size={11} />)}</button> : c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={rowKey ? rowKey(r) : i} data-click={onRow ? "" : undefined} tabIndex={onRow ? 0 : undefined} onClick={onRow ? () => onRow(r) : undefined} onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>
          {columns.map((c) => <td key={c.key} data-label={c.label} className={`${c.n ? "n" : ""} ${c.wrap ? "wrap" : ""}`}>{c.render ? c.render(r) : r[c.key] ?? "—"}</td>)}
        </tr>))}</tbody>
    </table></div>
  );
}
export function Pager({ d, onPage, noun = "results" }) {
  if (!d) return null;
  const from = d.total ? (d.page - 1) * d.pageSize + 1 : 0, to = Math.min(d.total, d.page * d.pageSize);
  return <div className="pager"><span>{from.toLocaleString()}–{to.toLocaleString()} of {d.total.toLocaleString()} {noun}</span><span className="adm-actions"><Btn size="sm" disabled={d.page <= 1} onClick={() => onPage(d.page - 1)}>Previous</Btn><span>Page {d.page} of {d.pages}</span><Btn size="sm" disabled={d.page >= d.pages} onClick={() => onPage(d.page + 1)}>Next</Btn></span></div>;
}

/** Accessible dialog: Escape closes, focus moves in and returns, Tab stays inside. */
export function Modal({ title, sub, onClose, children, footer, wide }) {
  const ref = useRef(null), prev = useRef(null), tid = useId();
  useEffect(() => {
    prev.current = document.activeElement; const el = ref.current; (el.querySelector("[data-autofocus], input, textarea, select, button:not([data-x])") ?? el).focus();
    const k = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") { const f = [...el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex="0"]')].filter((x) => x.offsetParent); if (!f.length) return; const a = f[0], z = f.at(-1); if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    };
    document.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; prev.current?.focus?.(); };
  }, []); // eslint-disable-line
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref} tabIndex={-1}>
        <header><div><h2 id={tid}>{title}</h2>{sub && <p>{sub}</p>}</div><button className="btn ghost sm" data-x onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <div className="modal-body">{children}</div>{footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** Pick a player by name: searches the directory as you type. onPick({ characterId, name, userId }). */
export function PlayerPicker({ value, onPick, label = "Player", hint }) {
  const [text, setText] = useState(""), [open, setOpen] = useState(false), d = useDebounced(text, 250), q = useApi("players", { q: d, hasCharacter: 1, pageSize: 8 }, { skip: d.trim().length < 2 });
  const rows = (q.data?.rows ?? []).filter((r) => r.characterId);
  if (value) return <div className="field"><span className="lab">{label}</span><span className="pill-sel"><Person name={value.name} size={24} /><button className="btn ghost sm" onClick={() => { onPick(null); setText(""); }} aria-label="Choose someone else"><X size={14} /></button></span></div>;
  return (
    <div className="field pick"><label htmlFor="pp">{label}</label>
      <input id="pp" className="inp" autoComplete="off" placeholder="Type at least 2 letters of a username" value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {hint && <span className="hint">{hint}</span>}
      {open && text.trim().length >= 2 && <ul role="listbox">{q.loading && !rows.length ? <li className="mut" style={{ padding: 10 }}>Searching…</li> : rows.length ? rows.map((r) => <li key={r.userId}><button onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick({ characterId: r.characterId, userId: r.userId, name: r.name }); setOpen(false); }}><Person name={r.name} sub={`${r.class ?? ""} · ${r.level ?? ""}L · ${kobo(r.balance)}`} size={26} /></button></li>) : <li className="mut" style={{ padding: 10 }}>No player with that name.</li>}</ul>}
    </div>
  );
}

/** Humanise a database-ish column name for generic tables. */
export const nice = (k) => String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Kobo$/, "").replace(/[_.]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
/** A cell of unknown shape: money columns (…Kobo / balance / capital / amount) as naira, dates as dates, lists joined. */
export function cell(k, v) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (/Kobo$|^(balance|capital|amount|paid|stake|price|pool|bill|spend)$/i.test(k) && /^-?\d+$/.test(String(v))) return kobo(v);
  if (/(At|Date|Until|Since)$/.test(k) || k === "createdAt") { const d = new Date(v); if (!Number.isNaN(+d) && String(v).includes("T")) return when(v); }
  return String(v);
}
export function useQueryState(initial) {
  const [s, setS] = useState(initial);
  const set = useCallback((patch) => setS((o) => ({ ...o, ...patch, ...(("page" in patch) ? {} : { page: 1 }) })), []);
  return [s, set];
}
export const useMemoQ = (o) => useMemo(() => o, [JSON.stringify(o)]); // eslint-disable-line react-hooks/exhaustive-deps
