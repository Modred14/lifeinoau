// components/apps/CallsApp.js: lives inside the phone (see components/Phone.js)
// Call home (Mummy / Daddy), ring another player to ask for money, and see your recent calls. This screen only starts calls and lists them: every call
// itself (ringing, answering, the money question) is shown by components/CallLayer.js, which stays on screen even if you close the phone.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneX, MagnifyingGlass, ChatCircleText, Coins } from "@phosphor-icons/react";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import { useResource } from "@/lib/gameStore";
import { callsDo, parentCall, useParentCall } from "@/lib/callsClient";
import { waitLabel } from "@/lib/callRules";
import { outcomeOf } from "../CallLayer";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import "./calls-app.css";

const ago = (at) => { const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000)); if (m < 1) return "Just now"; if (m < 60) return `${m}m ago`; const h = Math.round(m / 60); if (h < 24) return `${h}h ago`; const d = Math.round(h / 24); return d === 1 ? "Yesterday" : `${d} days ago`; };
const Av = ({ name, online }) => <span className="ca-av" aria-hidden="true">{String(name).trim().charAt(0).toUpperCase()}{online != null && <i className={online ? "on" : ""} />}</span>;
const HOME_TEXT = { GIVEN: (c) => `Sent ${naira(c.paidKobo ?? c.askKobo ?? 0)}`, REFUSED: () => "Said no", LATER: () => "Try again later", NO_ANSWER: () => "No answer", CALL_DECLINED: () => "Call declined" };

function Recent({ c, onCall }) {
  const parent = c.kind === "PARENT", incoming = c.direction === "incoming", missed = c.status === "MISSED" && incoming;
  const Ic = missed || c.status === "DECLINED" ? PhoneX : incoming ? PhoneIncoming : PhoneOutgoing;
  const text = parent ? HOME_TEXT[c.outcome]?.(c) ?? "Call" : outcomeOf(c).head;
  return (
    <li className={missed ? "miss" : ""}>
      <span className="ca-di" aria-hidden="true"><Ic size={18} weight="bold" /></span>
      <span className="ca-t"><b>{c.peer}</b><small>{parent ? "Home · " : incoming ? "Incoming · " : "Outgoing · "}{text}{c.seconds > 0 ? ` · ${Math.floor(c.seconds / 60)}:${String(c.seconds % 60).padStart(2, "0")}` : ""} · {ago(c.createdAt)}</small></span>
      {!parent && <button type="button" className="ca-re" onClick={() => onCall(c.peer)} aria-label={`Call ${c.peer}`}><Phone size={16} weight="fill" /></button>}
    </li>
  );
}

export default function CallsApp({ onOpenApp }) {
  const { d, store, load, loadFailed } = useResource("/api/calls?view=home");
  const ui = useParentCall(), [tab, setTab] = useState("people"), [q, setQ] = useState(""), [found, setFound] = useState(null), [recents, setRecents] = useState(null), [busy, setBusy] = useState(null), [away, setAway] = useState(null);
  const [, tick] = useState(0), seq = useRef(0), was = useRef(null);
  const loadedAt = useMemo(() => Date.now(), [d]); // eslint-disable-line react-hooks/exhaustive-deps -- when this answer arrived: the wait counts down from then, by the real clock
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []); // redraw the countdown
  useEffect(() => { if (was.current && !ui) { store.pushDone((x) => x); load(); } was.current = ui; }, [ui, load, store]); // when the call home ends, the cooldown and the weekly counts change
  const loadRecents = useCallback(async () => { const r = await call("/api/calls?view=history"); if (!r.failed) setRecents(r.calls); }, []);
  useEffect(() => { if (tab === "recents") loadRecents(); }, [tab, loadRecents]);
  useEffect(() => { // player search: wait for a pause in typing, and ignore answers that arrive late
    const term = q.trim(); if (term.length < 2) { setFound(null); return; }
    const mine = ++seq.current, t = setTimeout(async () => { const r = await call(`/api/calls?view=search&q=${encodeURIComponent(term)}`); if (mine === seq.current && !r.failed) setFound(r.players); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function dial(name) {
    if (busy) return; setBusy(name);
    const r = await callsDo({ action: "dial", to: name }, { quiet: true });
    setBusy(null);
    if (r.unavailable) { setAway(r); return; }
    if (r.failed || r.ok === false) { toast.error(r.error || r.message || "The call did not go through."); return; }
    if (tab === "recents") loadRecents();
  }

  if (loadFailed) return <LoadError onRetry={load} />;
  if (!d?.parent) return <Loader label="Opening Calls" />;
  const P = d.parent, wait = Math.max(0, P.waitMs - (Date.now() - loadedAt)), waiting = wait > 0, capped = P.callsThisWeek >= P.maxCallsPerWeek;
  const last = P.last;
  return (
    <div className="ca">
      <section className="card ca-home" aria-label={`Call ${P.name}`}>
        <div className="ca-home-top"><Av name={P.name} /><div className="ca-t"><b>{P.name}</b><small>{waiting ? `Free again in ${waitLabel(wait)}` : capped ? "You have called a lot this week" : "Home · ask for support"}</small></div></div>
        {last && <p className="ca-last"><Coins size={14} weight="fill" /> Last call {ago(last.at)}: {HOME_TEXT[last.outcome]?.({ paidKobo: last.giftKobo }) ?? "Call"}</p>}
        <p className="ca-sub">{P.callsThisWeek} of {P.maxCallsPerWeek} calls home this week. Gifts from home so far this week: {naira(P.giftsThisWeekKobo)} of {naira(P.weeklyCapKobo)}.</p>
        {P.missedStreak > 0 && <p className="ca-sub warn">You have not called home in {P.missedStreak} {P.missedStreak === 1 ? "week" : "weeks"}. They may be less generous.</p>}
        <button type="button" className="go ca-big" disabled={waiting || capped || !!ui} onClick={() => parentCall.start()}><Phone size={20} weight="fill" /> Call {P.name}</button>
      </section>

      <div role="tablist" aria-label="Calls sections">{[["people", "Call a player"], ["recents", "Recents"]].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}</div>

      {tab === "people" && <section aria-label="Call a player">
        <label className="ca-search"><MagnifyingGlass size={18} aria-hidden="true" /><span className="sr-only">Search players by name</span>
          <input type="search" placeholder="Search a player by name" value={q} maxLength={24} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
        <p className="ca-sub">Ask a player for money. They see the amount and choose whether to send it. You can only ring players who are online.</p>
        {found ? (found.length === 0 ? <p className="ca-empty">No players found.</p> : <ul className="ca-list">{found.map((p) => (
          <li key={p.name}><Av name={p.name} online={p.online} /><span className="ca-t"><b>{p.name}</b><small>{p.online ? "Online" : "Offline"} · {p.level}L · {p.faculty}</small></span>
            <button type="button" className="go ca-re" disabled={!!busy} onClick={() => dial(p.name)} aria-label={`Call ${p.name}`}><Phone size={16} weight="fill" /></button></li>))}</ul>)
          : d.recents.length > 0 ? <><h3 className="ca-h">Recently called</h3><ul className="ca-list">{d.recents.map((p) => (
            <li key={p.name}><Av name={p.name} online={p.online} /><span className="ca-t"><b>{p.name}</b><small>{p.online ? "Online" : "Offline"}</small></span>
              <button type="button" className="go ca-re" disabled={!!busy} onClick={() => dial(p.name)} aria-label={`Call ${p.name}`}><Phone size={16} weight="fill" /></button></li>))}</ul></>
          : <p className="ca-empty">Type at least two letters to find a player.</p>}
      </section>}

      {tab === "recents" && (!recents ? <Loader fullscreen={false} size={28} label="Loading calls" />
        : recents.length === 0 ? <p className="ca-empty">No calls yet.</p>
        : <ul className="ca-list ca-rec">{recents.map((c) => <Recent key={c.id} c={c} onCall={dial} />)}</ul>)}

      {away && (
        <div className="ph-sheet-scrim" onClick={() => setAway(null)}>
          <div className="ph-sheet" role="dialog" aria-modal="true" aria-label={`${away.peer} is unavailable`} onClick={(e) => e.stopPropagation()}>
            <span className="ph-grab" aria-hidden="true" />
            <h3>{away.reason === "offline" ? `${away.peer} is offline` : away.reason === "busy" ? `${away.peer} is busy` : `${away.peer} is unavailable`}</h3>
            <p className="ca-sub">{away.message}</p>
            <div className="ca-away">
              {away.reason !== "busy" && <button type="button" className="go" onClick={() => { const who = away.peer; setAway(null); onOpenApp?.("messages", who); }}><ChatCircleText size={18} weight="fill" /> Send a message</button>}
              {away.reason === "busy" && <button type="button" className="go" onClick={() => { const who = away.peer; setAway(null); dial(who); }}>Try again</button>}
              <button type="button" onClick={() => setAway(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
