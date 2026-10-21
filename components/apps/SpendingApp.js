// components/apps/SpendingApp.js: lives inside the phone (see components/Phone.js)
// The player's nightlife spending: totals and a list of every completed club purchase. All of it is read from the stored transactions on the server
// (GET /api/club?view=history), which only ever answers for the signed-in player: nothing is counted on this screen, and nothing here is kept in the browser.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import Loader from "@/components/Loader";
import { CLUBS, CLUB_IDS } from "@/lib/clubs.js";
import "@/components/club.css";

const TYPES = [["", "All types"], ["drinks", "Drinks"], ["spray", "Money spraying"], ["vip", "VIP & experiences"], ["buyout", "Club buyouts"]];
const when = (ms) => new Date(ms).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

export default function Spending() {
  const [sum, setSum] = useState(null), [items, setItems] = useState(null), [next, setNext] = useState(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [club, setClub] = useState(""), [type, setType] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const seq = useRef(0);

  const q = useCallback((cursor) => { const p = new URLSearchParams({ view: "history", limit: "15" }); if (club) p.set("club", club); if (type) p.set("type", type); if (from) p.set("from", from); if (to) p.set("to", to); if (cursor) p.set("cursor", cursor); return "/api/club?" + p; }, [club, type, from, to]);
  const load = useCallback(async (cursor = null) => {
    const my = ++seq.current; setBusy(true); const r = await call(q(cursor)); if (my !== seq.current) return; setBusy(false); // a newer filter was chosen meanwhile: ignore this answer
    if (r.failed) { setFailed(true); if (!r.aborted) toast.error(r.error || "Could not load your spending."); return; }
    setFailed(false); setSum(r.summary); setNext(r.next); setItems((old) => (cursor && old ? [...old, ...r.items] : r.items));
  }, [q]);
  useEffect(() => { load(null); }, [load]); // the first look, and again whenever a filter changes (the list starts over from the newest)

  const k = (v) => naira(v ?? "0"), mv = sum?.mostVisited;
  return (
    <>
      <div className="top"><h2>Club Spending</h2><a href="/home"><button>Back to game</button></a></div>
      <p className="mut">What you have spent at 0203, Royal Divas and Quantum. Only purchases that went through are counted.</p>
      {!sum && !failed && <Loader label="Loading your spending" />}
      {failed && !sum && <div className="sp-empty"><b>Could not load</b>Check your connection and <button type="button" onClick={() => load(null)}>try again</button>.</div>}
      {sum && (
        <div className="sp">
          <div className="sp-total"><small>TOTAL CLUB SPENDING</small><b>{k(sum.totalKobo)}</b><small>{sum.count} {sum.count === 1 ? "transaction" : "transactions"}</small></div>
          <div className="sp-grid">
            {CLUB_IDS.map((id) => <div key={id} className="sp-stat"><small>{CLUBS[id].name}</small><b>{k(sum.perClub[id])}</b></div>)}
            <div className="sp-stat"><small>Drinks</small><b>{k(sum.perGroup.drinks)}</b></div>
            <div className="sp-stat"><small>Money spraying</small><b>{k(sum.perGroup.spray)}</b></div>
            <div className="sp-stat"><small>Club buyouts</small><b>{k(sum.perGroup.buyout)}</b></div>
            <div className="sp-stat"><small>VIP packages &amp; other</small><b>{k(sum.perGroup.vip)}</b></div>
            <div className="sp-stat"><small>Most expensive purchase</small><b>{sum.biggest ? k(sum.biggest.amountKobo) : "None yet"}</b>{sum.biggest && <small>{sum.biggest.itemName}</small>}</div>
            <div className="sp-stat"><small>Most visited club</small><b>{mv ? CLUBS[mv.clubId].name : "None yet"}</b>{mv && <small>{mv.nights} party {mv.nights === 1 ? "night" : "nights"}</small>}</div>
          </div>

          <div className="sp-filters" role="group" aria-label="Filter your transactions">
            <select value={club} onChange={(e) => setClub(e.target.value)} aria-label="Club"><option value="">All clubs</option>{CLUB_IDS.map((id) => <option key={id} value={id}>{CLUBS[id].name}</option>)}</select>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type of purchase">{TYPES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>

          {items == null ? <Loader label="Loading transactions" /> : items.length === 0 ? (
            <div className="sp-empty"><b>{sum.count === 0 ? "No club spending yet" : "Nothing matches these filters"}</b>{sum.count === 0 ? "When you spray money, order a bottle or reserve a table at a club, it will show up here." : "Try a different club, type or date range."}</div>
          ) : (
            <ul className="sp-list">{items.map((t) => (
              <li key={t.id} className="sp-item">
                <h4>{t.club.toUpperCase()} · {t.type.toUpperCase()}</h4>
                <b>{t.name}{t.recipient ? ` → for ${t.recipient}` : ""}</b>
                <span className="amt">{naira(t.amountKobo)}</span>
                <small>{when(t.at)} · <span className="sp-ok">{t.status === "COMPLETED" ? "Completed" : t.status}</span></small>
              </li>))}</ul>
          )}
          {next && <button type="button" className="go" disabled={busy} onClick={() => load(next)}>{busy ? "Loading…" : "Load more"}</button>}
        </div>
      )}
    </>
  );
}