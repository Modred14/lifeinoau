// components/apps/BankApp.js: lives inside the phone (see components/Phone.js)
// The Bank: your card and balances, net worth, saving and withdrawing, savings goals and the statement. Every number comes from /api/bank; the server
// checks every move (lib/bankService.js), this screen only asks and shows what happened.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PiggyBank, Target, ArrowUpRight, ArrowDownLeft, ArrowsLeftRight, Receipt, Gift, Plus, Lock, Wallet } from "@phosphor-icons/react";
import { call, naira } from "@/lib/client";
import { game, run, cash, canAfford, useResource } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import { newId } from "@/lib/callsClient";
import { BANK, parseNaira } from "@/lib/bankRules";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import "./bank-app.css";

const K = (v) => BigInt(v ?? 0);
const grouped = (n) => String(n).replace(/(\d{4})(?=\d)/g, "$1 ");
const when = (at) => new Date(at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const PARTS = [["cash", "Cash", "var(--blue)"], ["savings", "Savings", "var(--green)"], ["business", "Business", "var(--gold-text)"], ["investments", "Investments", "#8b5cf6"]];
const CAT_ICON = { savings: PiggyBank, transfer: ArrowsLeftRight, fee: Receipt, family: Gift, income: ArrowDownLeft, spending: ArrowUpRight };
const FILTERS = [["all", "All"], ["in", "Money in"], ["out", "Money out"], ["savings", "Savings"], ["transfers", "Transfers"]];

function BankCard({ d }) {
  return (
    <section className="bk-card" data-cls={d.card.cls} aria-label="Your bank card">
      <div className="bk-card-top"><span className="bk-brand">OAU Bank</span><span className="bk-tier">{d.card.tier}</span></div>
      <span className="bk-chip" aria-hidden="true" />
      <p className="bk-label">Available balance</p>
      <p className="bk-bal" aria-live="polite">{naira(d.availableKobo)}</p>
      <div className="bk-card-bot"><span className="bk-holder">{d.card.holder}</span><span className="bk-num" aria-label={`Account number ${d.card.number}`}>{grouped(d.card.number)}</span></div>
    </section>
  );
}

function NetWorth({ d }) {
  const total = K(d.netWorth.totalKobo), parts = PARTS.map(([k, label, color]) => ({ k, label, color, v: K(d.netWorth.parts[k]) })).filter((p) => p.v > 0n);
  return (
    <section className="card bk-nw" aria-label="Net worth">
      <div className="bk-row"><span className="bk-label">Net worth</span><b className="bk-nw-total">{naira(total)}</b></div>
      <div className="bk-stack" role="img" aria-label={`Net worth split: ${parts.map((p) => `${p.label} ${naira(p.v)}`).join(", ") || "nothing yet"}`}>
        {parts.map((p) => <i key={p.k} style={{ width: `${Math.max(2, Number((p.v * 10000n) / (total || 1n)) / 100)}%`, background: p.color }} />)}
      </div>
      <ul className="bk-legend">{parts.map((p) => <li key={p.k}><i style={{ background: p.color }} aria-hidden="true" />{p.label}<b>{naira(p.v)}</b></li>)}</ul>
      <p className="bk-note"><Lock size={12} weight="fill" /> Saving money never changes your net worth. Cars and clothes are not counted because they cannot be resold.</p>
    </section>
  );
}

function Goal({ g, onFund, onTake, onClose }) {
  const done = g.status === "ACHIEVED";
  return (
    <li className={`bk-goal${done ? " done" : ""}`}>
      <div className="bk-row"><b>{g.name}</b><span className="bk-pct">{done ? "Reached" : `${g.pct}%`}</span></div>
      <div className="bk-prog" role="progressbar" aria-label={`${g.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.pct}><i style={{ width: `${g.pct}%` }} /></div>
      <p className="bk-sub">{naira(g.savedKobo)} of {naira(g.targetKobo)}</p>
      <div className="bk-acts">
        {!done && <button type="button" onClick={() => onFund(g)}>Add</button>}
        {K(g.savedKobo) > 0n && <button type="button" onClick={() => onTake(g)}>Take out</button>}
        <button type="button" onClick={() => onClose(g)}>{done ? "Done" : "Close"}</button>
      </div>
    </li>
  );
}

/** One sheet for every amount the player types: save, withdraw, set aside for a goal, make a goal. */
function Sheet({ d, store, kind, goal, onDone, onCancel }) {
  const [amt, setAmt] = useState(""), [name, setName] = useState(""), [to, setTo] = useState(goal?.id ?? ""), [busy, setBusy] = useState(false), ref = useRef(null);
  useEffect(() => { ref.current?.focus(); const esc = (e) => e.key === "Escape" && onCancel(); window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [onCancel]);
  const free = K(d.freeSavingsKobo), open = d.goals.filter((g) => g.status === "ACTIVE");
  const src = kind === "withdraw" ? (to ? d.goals.find((g) => g.id === to) : null) : null;
  const max = kind === "save" ? K(d.availableKobo) : kind === "withdraw" ? (src ? K(src.savedKobo) : free) : kind === "fund" ? (free < K(goal.targetKobo) - K(goal.savedKobo) ? free : K(goal.targetKobo) - K(goal.savedKobo)) : 0n;
  const lim = kind === "goal" ? { min: BANK.goalMinNaira, max: BANK.goalMaxNaira, what: "target" } : { min: BANK.minNaira, max: BANK.maxNaira, what: "amount" };
  const p = parseNaira(amt, lim), n = p.n, valid = !p.error && (kind === "goal" ? name.trim().length > 0 : BigInt(n) * 100n <= max);
  const T = { save: ["Save money", "Move money from your balance into savings.", `You have ${naira(d.availableKobo)} available.`], withdraw: ["Withdraw", "Move savings back to your balance.", `${naira(max)} can be withdrawn${src ? ` from ${src.name}` : ""}.`],
    fund: ["Set aside", `Set aside savings for ${goal?.name}.`, `${naira(max)} of your savings is free to set aside.`], goal: ["New savings goal", "Pick a name and a target.", ""] }[kind];
  async function go() {
    if (!valid || busy) return; setBusy(true);
    const requestId = newId(), amountNaira = n;
    const body = kind === "save" ? { action: "deposit", amountNaira, goalId: to || undefined, requestId } : kind === "withdraw" ? { action: "withdraw", amountNaira, goalId: to || undefined, requestId }
      : kind === "fund" ? { action: "goal.fund", goalId: goal.id, amountNaira, requestId } : { action: "goal.create", name, targetNaira: amountNaira, requestId };
    const spend = kind === "save" ? BigInt(amountNaira) * 100n : 0n;
    if (spend > 0n && !canAfford(spend)) { setBusy(false); return toast.error("You do not have enough money for that."); }
    const msg = { save: `Saved ${naira(BigInt(amountNaira) * 100n)}.`, withdraw: `Withdrew ${naira(BigInt(amountNaira) * 100n)}.`, fund: "Set aside for your goal.", goal: "Savings goal created." }[kind];
    // The bank screen is registered as changed too (a no-op patch): that is how the store knows a read that started BEFORE this change is stale and must be asked again,
    // and it schedules the fresh read itself once the server has answered.
    const effects = [{ store, patch: (x) => x }, ...(kind === "save" ? [{ store: game, patch: cash(-spend) }] : kind === "withdraw" ? [{ store: game, patch: cash(BigInt(amountNaira) * 100n) }] : [])];
    const res = await run({ key: `bank:${kind}`, sensitive: true, pending: "Moving your money…", ok: msg, sound: kind === "goal" || kind === "fund" ? "success" : "coin", request: () => call("/api/bank", body), effects });
    setBusy(false);
    if (!res.failed) onDone();
  }
  return (
    <div className="ph-sheet-scrim" onClick={onCancel}>
      <div className="ph-sheet bk-sheet" role="dialog" aria-modal="true" aria-label={T[0]} onClick={(e) => e.stopPropagation()}>
        <span className="ph-grab" aria-hidden="true" />
        <h3>{T[0]}</h3><p className="bk-sub">{T[1]}</p>
        {kind === "goal" && <><label htmlFor="bk-name">Goal name</label><input id="bk-name" ref={ref} type="text" maxLength={BANK.nameMax} placeholder="New laptop" value={name} onChange={(e) => setName(e.target.value)} /></>}
        {kind === "save" && open.length > 0 && <><label htmlFor="bk-to">Save towards</label><select id="bk-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Savings (no goal)</option>{open.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></>}
        {kind === "withdraw" && <><label htmlFor="bk-from">Withdraw from</label><select id="bk-from" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Free savings ({naira(free)})</option>{d.goals.filter((g) => K(g.savedKobo) > 0n).map((g) => <option key={g.id} value={g.id}>{g.name} ({naira(g.savedKobo)})</option>)}</select></>}
        <label htmlFor="bk-amt">{kind === "goal" ? "Target (₦)" : "Amount (₦)"}</label>
        <input id="bk-amt" ref={kind === "goal" ? undefined : ref} type="text" inputMode="numeric" autoComplete="off" placeholder="0" value={amt ? Number(amt).toLocaleString("en-NG") : ""} onChange={(e) => setAmt(e.target.value.replace(/\D/g, "").slice(0, 10))} aria-invalid={!!amt && !valid} aria-describedby="bk-help" />
        {kind !== "goal" && <div className="bk-chips">{[1000, 5000, 10000].map((v) => <button key={v} type="button" onClick={() => setAmt(String(v))}>₦{v.toLocaleString("en-NG")}</button>)}<button type="button" disabled={max < 10_000n} onClick={() => setAmt(String(max / 100n > BigInt(BANK.maxNaira) ? BANK.maxNaira : max / 100n))}>All</button></div>}
        <p id="bk-help" className={`bk-sub${amt && !valid ? " bad" : ""}`}>{amt && p.error ? p.error : amt && !valid && kind !== "goal" ? "That is more than you can use here." : T[2]}</p>
        <div className="bk-sheet-acts"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="go" disabled={!valid || busy} onClick={go}>{busy ? "Working…" : T[0]}</button></div>
      </div>
    </div>
  );
}

/** `version` changes when the account does (a new newest transaction): the first page is read again, and the filter the player chose is kept. */
function Statement({ version }) {
  const [filter, setFilter] = useState("all"), [rows, setRows] = useState(null), [next, setNext] = useState(null), [more, setMore] = useState(false), [err, setErr] = useState(false);
  const fetchPage = useCallback(async (f, cursor) => {
    const r = await call(`/api/bank?view=history&filter=${f}${cursor ? `&cursor=${cursor}` : ""}`);
    if (r.failed) { setErr(true); setMore(false); return; }
    setErr(false); setRows((old) => (cursor ? [...(old ?? []), ...r.rows] : r.rows)); setNext(r.next); setMore(false);
  }, []);
  const shown = useRef(null);
  useEffect(() => { if (shown.current !== filter) { setRows(null); shown.current = filter; } fetchPage(filter, null); }, [filter, version, fetchPage]);
  return (
    <div>
      <div className="bk-filters" role="tablist" aria-label="Filter transactions">{FILTERS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>)}</div>
      {err && !rows ? <p className="bk-empty">Could not load your transactions. <button type="button" onClick={() => fetchPage(filter, null)}>Try again</button></p>
        : !rows ? <Loader fullscreen={false} size={28} label="Loading transactions" />
        : rows.length === 0 ? <p className="bk-empty">No transactions here yet.</p>
        : <ul className="bk-tx">{rows.map((t) => { const Ic = CAT_ICON[t.category] ?? Wallet, inn = t.direction === "in"; return (
          <li key={t.id}><span className="bk-ic" data-d={t.direction} aria-hidden="true"><Ic size={18} weight="bold" /></span>
            <span className="bk-tx-t"><b>{t.title}</b><small>{t.detail ? `${t.detail} · ` : ""}{when(t.at)}</small></span>
            <b className={`bk-amt ${inn ? "in" : "out"}`}><span className="sr-only">{inn ? "Money in " : "Money out "}</span>{inn ? "+" : "−"}{naira(t.amountKobo)}</b></li>); })}</ul>}
      {next && <button type="button" className="bk-more" disabled={more} onClick={() => { setMore(true); fetchPage(filter, next); }}>{more ? "Loading…" : "Show more"}</button>}
    </div>
  );
}

export default function BankApp() {
  const { d, store, load, loadFailed } = useResource("/api/bank");
  const [tab, setTab] = useState("home"), [sheet, setSheet] = useState(null);
  if (loadFailed) return <LoadError onRetry={load} />;
  if (!d?.card) return <Loader label="Opening your account" />;
  const goals = d.goals, free = K(d.freeSavingsKobo);
  async function closeGoal(g) {
    const held = K(g.savedKobo);
    if (!(await confirmAction({ title: g.status === "ACHIEVED" ? "Finish this goal?" : "Close this goal?", message: held > 0n ? `${naira(held)} set aside for "${g.name}" goes back to your free savings. Nothing leaves your savings account.` : `"${g.name}" will be removed.`, confirmLabel: g.status === "ACHIEVED" ? "Finish" : "Close goal" }))) return;
    await run({ key: `bank:close:${g.id}`, sensitive: true, pending: "Closing goal…", ok: "Goal closed.", effects: [{ store, patch: (x) => x }], request: () => call("/api/bank", { action: "goal.close", goalId: g.id, requestId: newId() }) });
  }
  return (
    <div className="bk">
      <BankCard d={d} />
      <div className="bk-actions"><button type="button" className="go" onClick={() => setSheet({ kind: "save" })} disabled={K(d.availableKobo) < 10_000n}><PiggyBank size={18} weight="fill" /> Save</button>
        <button type="button" onClick={() => setSheet({ kind: "withdraw" })} disabled={K(d.savingsKobo) === 0n}><Wallet size={18} weight="fill" /> Withdraw</button></div>
      <div role="tablist" aria-label="Bank sections">{[["home", "Overview"], ["savings", "Savings"], ["history", "History"]].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}</div>

      {tab === "home" && <>
        <section className="bk-grid" aria-label="Balances"><div className="card"><span className="bk-label">Spendable</span><b>{naira(d.availableKobo)}</b></div><div className="card"><span className="bk-label">Savings</span><b>{naira(d.savingsKobo)}</b></div></section>
        <NetWorth d={d} />
        <section className="card" aria-label="Recent transactions"><div className="bk-row"><b>Recent</b><button type="button" className="bk-link" onClick={() => setTab("history")}>See all</button></div>
          {d.recent.length === 0 ? <p className="bk-empty">No transactions yet.</p> : <ul className="bk-tx">{d.recent.map((t) => { const Ic = CAT_ICON[t.category] ?? Wallet, inn = t.direction === "in"; return (
            <li key={t.id}><span className="bk-ic" data-d={t.direction} aria-hidden="true"><Ic size={18} weight="bold" /></span><span className="bk-tx-t"><b>{t.title}</b><small>{when(t.at)}</small></span><b className={`bk-amt ${inn ? "in" : "out"}`}>{inn ? "+" : "−"}{naira(t.amountKobo)}</b></li>); })}</ul>}</section>
      </>}

      {tab === "savings" && <>
        <section className="card bk-sv" aria-label="Savings"><div className="bk-row"><span className="bk-label"><PiggyBank size={14} weight="fill" /> Savings balance</span><b className="bk-nw-total">{naira(d.savingsKobo)}</b></div>
          <p className="bk-sub">{naira(free)} free · {naira(d.setAsideKobo)} set aside for goals. Savings do not earn interest and are never spent by accident.</p></section>
        <div className="bk-row bk-goals-h"><h3><Target size={16} weight="fill" /> Savings goals</h3><button type="button" disabled={goals.length >= d.limits.maxGoals} onClick={() => setSheet({ kind: "goal" })}><Plus size={14} weight="bold" /> New goal</button></div>
        {goals.length === 0 ? <p className="bk-empty">Set a target and save towards it. Your progress shows here.</p>
          : <ul className="bk-goals">{goals.map((g) => <Goal key={g.id} g={g} onFund={(x) => setSheet({ kind: free > 0n ? "fund" : "save", goal: x })} onTake={(x) => setSheet({ kind: "withdraw", goal: x })} onClose={closeGoal} />)}</ul>}
      </>}

      {tab === "history" && <Statement version={d.recent[0]?.id ?? "none"} />}

      {sheet && <Sheet d={d} store={store} kind={sheet.kind} goal={sheet.goal} onCancel={() => setSheet(null)} onDone={() => setSheet(null)} />}
    </div>
  );
}
