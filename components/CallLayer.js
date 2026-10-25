// components/CallLayer.js
// Everything on screen during a call, mounted once for the whole app (src/app/layout.js) so a call looks and behaves the same whether the phone is open or not:
//  - the incoming-call screen (Answer / Decline) for the player being rung,
//  - the call screen for both sides (calling -> ringing -> connected), where the caller asks for an amount and the other player approves or rejects it,
//  - the result of a call that just ended (money received / sent, declined, missed ...),
//  - the call home screen (Mummy / Daddy).
// It also runs the poll that tells the server "this player's game is open", which is what makes a player callable. The server decides everything; this only shows it.
"use client";
import { useEffect, useRef, useState } from "react";
import { Phone, PhoneDisconnect, PhoneIncoming, Check, X, Lock } from "@phosphor-icons/react";
import { naira } from "@/lib/client";
import { useStore } from "@/lib/optimistic";
import { useGame } from "@/lib/gameStore";
import { serverTime } from "@/lib/serverClock";
import { playSound } from "@/lib/sound";
import { callsLive, callsDo, startCallPolling, parentCall, useParentCall, syncGame } from "@/lib/callsClient";
import { PLAYER_CALL } from "@/lib/callRules";
import "./call-layer.css";

const left = (iso) => (iso ? Math.max(0, new Date(iso).getTime() - serverTime()) : 0);
const clock = (ms) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
/** Re-render a few times a second while a call is on (countdowns and the call timer). */
function useTick(on, ms = 250) { const [, set] = useState(0); useEffect(() => { if (!on) return; const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [on, ms]); }
const Avatar = ({ name, ring }) => <span className={`cx-av${ring ? " cx-ring" : ""}`} aria-hidden="true">{String(name || "?").trim().charAt(0).toUpperCase()}</span>;
const Bar = ({ ms, total }) => <span className="cx-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (ms / total) * 100)}%` }} /></span>;

/** What the finished call comes to, from this player's side: a headline, a detail line and a tone. */
export function outcomeOf(c) {
  const me = c.role, peer = c.peer, amt = c.askKobo ? naira(c.askKobo) : "";
  if (c.askStatus === "APPROVED") return me === "caller" ? { tone: "ok", head: `${amt} received`, sub: `${peer} approved your request. It is in your balance.` } : { tone: "ok", head: `${amt} sent`, sub: `To ${peer}. The fee was ${naira(c.feeKobo ?? 0)}.` };
  if (c.askStatus === "REJECTED") return me === "caller" ? { tone: "bad", head: "Request declined", sub: `${peer} said no. Nothing was sent.` } : { tone: "info", head: "You declined", sub: `No money was sent to ${peer}.` };
  if (c.askStatus === "FAILED") return me === "caller" ? { tone: "bad", head: "Could not be sent", sub: `${peer} was not able to send it right now. Nothing moved.` } : { tone: "bad", head: "Not sent", sub: "You did not have enough to cover the amount and the fee." };
  if (c.askStatus === "EXPIRED") return { tone: "info", head: "No response", sub: me === "caller" ? `${peer} did not respond in time. Nothing was sent.` : "The request ran out of time. Nothing was sent." };
  if (c.askStatus === "CANCELLED") return { tone: "info", head: "Request withdrawn", sub: me === "caller" ? "You hung up before they answered." : `${peer} hung up.` };
  if (c.status === "DECLINED") return { tone: "bad", head: "Call declined", sub: me === "caller" ? `${peer} declined your call.` : "You declined the call." };
  if (c.status === "MISSED") return { tone: "info", head: "No answer", sub: me === "caller" ? `${peer} did not pick up.` : "You missed this call." };
  if (c.status === "CANCELLED") return { tone: "info", head: "Call cancelled", sub: me === "caller" ? "You hung up before it was answered." : `${peer} stopped calling.` };
  return { tone: "info", head: "Call ended", sub: c.answeredAt && c.endedAt ? `Lasted ${clock(new Date(c.endedAt) - new Date(c.answeredAt))}.` : "" };
}

function Ringing({ c, busy, act }) {
  useEffect(() => { // ring until it is answered, declined or runs out
    playSound("receive"); navigator.vibrate?.([220, 120, 220]);
    const t = setInterval(() => { playSound("receive"); navigator.vibrate?.([220, 120, 220]); }, 3200);
    return () => clearInterval(t);
  }, [c.id]);
  return (
    <section className="cx" role="alertdialog" aria-modal="true" aria-label={`Incoming call from ${c.peer}`}>
      <Avatar name={c.peer} ring />
      <p className="cx-kind"><PhoneIncoming size={16} weight="fill" /> Incoming call</p>
      <h2>{c.peer}</h2>
      <p className="cx-sub">is calling you</p>
      <Bar ms={left(c.ringUntil)} total={PLAYER_CALL.ringMs} />
      <div className="cx-act">
        <button type="button" className="cx-btn cx-no" disabled={busy} onClick={() => act({ action: "end" })} aria-label="Decline the call"><PhoneDisconnect size={26} weight="fill" /><span>Decline</span></button>
        <button type="button" className="cx-btn cx-yes" disabled={busy} onClick={() => act({ action: "answer" })} aria-label="Answer the call" autoFocus><Phone size={26} weight="fill" /><span>Answer</span></button>
      </div>
    </section>
  );
}

function Connected({ c, busy, act, balanceKobo }) {
  const [amt, setAmt] = useState(""), n = Number(amt), valid = Number.isInteger(n) && n >= PLAYER_CALL.askMinNaira && n <= PLAYER_CALL.askMaxNaira;
  const caller = c.role === "caller", talking = c.answeredAt ? new Date(serverTime()) - new Date(c.answeredAt) : 0;
  const pending = c.askStatus === "PENDING";
  const cost = c.costKobo ? BigInt(c.costKobo) : 0n, short = !caller && pending && balanceKobo != null && BigInt(balanceKobo) < cost;
  return (
    <section className="cx" role="dialog" aria-modal="true" aria-label={`Call with ${c.peer}`}>
      <Avatar name={c.peer} />
      <p className="cx-kind cx-live"><span className="cx-dot" aria-hidden="true" /> Connected · {clock(talking)}</p>
      <h2>{c.peer}</h2>

      {caller && !pending && (
        <div className="cx-ask">
          <p className="cx-sub">Need some money? {c.peer} decides whether to send it.</p>
          <label className="cx-lab" htmlFor="cx-amt">How much do you want to ask for?</label>
          <div className="cx-money"><span aria-hidden="true">₦</span>
            <input id="cx-amt" inputMode="numeric" autoComplete="off" placeholder="0" value={amt ? Number(amt).toLocaleString("en-NG") : ""} onChange={(e) => setAmt(e.target.value.replace(/\D/g, "").slice(0, 7))} aria-describedby="cx-hint" /></div>
          <div className="cx-chips">{[1000, 5000, 10000, 20000].map((v) => <button key={v} type="button" className="cx-chip" onClick={() => setAmt(String(v))}>₦{v.toLocaleString("en-NG")}</button>)}</div>
          <p id="cx-hint" className="cx-hint"><Lock size={13} weight="fill" /> Nothing is taken from {c.peer}. They see the amount and must approve it.</p>
          <button type="button" className="cx-btn cx-wide cx-yes" disabled={busy || !valid} onClick={() => act({ action: "ask", amountNaira: n })}>{valid ? `Ask for ₦${n.toLocaleString("en-NG")}` : "Enter an amount"}</button>
        </div>
      )}
      {caller && pending && (
        <div className="cx-ask" aria-live="polite">
          <p className="cx-big">{naira(c.askKobo)}</p>
          <p className="cx-sub">Waiting for {c.peer} to respond…</p>
          <Bar ms={left(c.askUntil)} total={PLAYER_CALL.askMs} />
        </div>
      )}
      {!caller && !pending && <p className="cx-sub cx-ask">You are on a call with {c.peer}. If they ask for money, you will choose whether to send it.</p>}
      {!caller && pending && (
        <div className="cx-ask" role="group" aria-label="Money request" aria-live="polite">
          <p className="cx-sub">{c.peer} is asking you for</p>
          <p className="cx-big">{naira(c.askKobo)}</p>
          <dl className="cx-sum"><div><dt>Amount</dt><dd>{naira(c.askKobo)}</dd></div><div><dt>Transfer fee (2%)</dt><dd>{naira(cost - BigInt(c.askKobo))}</dd></div><div className="cx-tot"><dt>You pay</dt><dd>{naira(cost)}</dd></div></dl>
          <Bar ms={left(c.askUntil)} total={PLAYER_CALL.askMs} />
          {short && <p className="cx-warn" role="alert">You do not have enough to cover this.</p>}
          <div className="cx-act cx-two">
            <button type="button" className="cx-btn cx-no" disabled={busy} onClick={() => act({ action: "reject" })}><X size={22} weight="bold" /><span>Reject</span></button>
            <button type="button" className="cx-btn cx-yes" disabled={busy || short} onClick={() => act({ action: "approve" })}><Check size={22} weight="bold" /><span>Approve</span></button>
          </div>
          <p className="cx-hint"><Lock size={13} weight="fill" /> Only approve if you want to send this money.</p>
        </div>
      )}
      <button type="button" className="cx-hang" disabled={busy} onClick={() => act({ action: "end" })} aria-label="Hang up"><PhoneDisconnect size={24} weight="fill" /></button>
    </section>
  );
}

function Outgoing({ c, busy, act }) {
  const ringing = !!c.ringingAt;
  return (
    <section className="cx" role="dialog" aria-modal="true" aria-label={`Calling ${c.peer}`}>
      <Avatar name={c.peer} ring />
      <p className="cx-kind" aria-live="polite">{ringing ? "Ringing…" : "Calling…"}</p>
      <h2>{c.peer}</h2>
      <p className="cx-sub">{ringing ? "Their phone is ringing" : "Reaching their phone"}</p>
      <Bar ms={left(c.ringUntil)} total={PLAYER_CALL.ringMs} />
      <button type="button" className="cx-hang" disabled={busy} onClick={() => act({ action: "end" })} aria-label="Cancel the call"><PhoneDisconnect size={24} weight="fill" /></button>
    </section>
  );
}

function Result({ c, onDone }) {
  const o = outcomeOf(c);
  useEffect(() => { playSound(o.tone === "ok" ? "coin" : o.tone === "bad" ? "error" : "close"); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="cx" role="dialog" aria-modal="true" aria-label="Call finished" data-tone={o.tone}>
      <span className="cx-res" aria-hidden="true">{o.tone === "ok" ? <Check size={34} weight="bold" /> : o.tone === "bad" ? <X size={34} weight="bold" /> : <PhoneDisconnect size={30} weight="fill" />}</span>
      <h2 aria-live="polite">{o.head}</h2>
      <p className="cx-sub">{o.sub}</p>
      <p className="cx-with">{c.peer}</p>
      <button type="button" className="cx-btn cx-wide cx-yes" onClick={onDone} autoFocus>Done</button>
    </section>
  );
}

const HOME_LINES = { dialing: "Connecting…", calling: "Calling…", ringing: "Ringing…", answered: "Picked up", declined: "Call declined", noanswer: "No answer", talking: "Connected", ended: "Call ended" };
function HomeCall({ ui }) {
  const r = ui.result, c = r?.call, gift = BigInt(r?.giftKobo ?? 0), talking = ["talking", "ended"].includes(ui.phase), over = ui.phase === "ended" || ui.phase === "declined" || ui.phase === "noanswer";
  const o = c?.outcome;
  return (
    <section className="cx" role="dialog" aria-modal="true" aria-label={`Calling ${ui.name}`} data-tone={o === "GIVEN" && talking ? "ok" : undefined}>
      <Avatar name={ui.name} ring={["calling", "ringing", "dialing"].includes(ui.phase)} />
      <p className={`cx-kind${ui.phase === "talking" ? " cx-live" : ""}`} aria-live="polite">{ui.phase === "talking" && <span className="cx-dot" aria-hidden="true" />}{HOME_LINES[ui.phase]}</p>
      <h2>{ui.name}</h2>
      {talking && c?.line && <p className="cx-quote">{c.line}</p>}
      {ui.phase === "noanswer" && <p className="cx-sub">{c.line}</p>}
      {ui.phase === "declined" && <p className="cx-sub">{c.line}</p>}
      {talking && gift > 0n && <p className="cx-big cx-gift" aria-live="polite">+{naira(gift)}</p>}
      {ui.phase === "ended" && gift === 0n && o !== "NO_ANSWER" && o !== "CALL_DECLINED" && <p className="cx-sub">No money this time.</p>}
      {ui.phase === "ended" && gift > 0n && <p className="cx-sub">It is in your balance.</p>}
      {(over || ui.phase === "ended") ? <button type="button" className="cx-btn cx-wide cx-yes" onClick={() => parentCall.dismiss()} autoFocus>Done</button>
        : <button type="button" className="cx-hang" onClick={() => parentCall.dismiss()} aria-label="Hang up"><PhoneDisconnect size={24} weight="fill" /></button>}
    </section>
  );
}

export default function CallLayer() {
  const g = useGame(), live = useStore(callsLive), ui = useParentCall();
  const ready = !!g?.character, active = live?.active ?? null, last = live?.last ?? null;
  const [seen, setSeen] = useState(null), [busy, setBusy] = useState(false), busyRef = useRef(false);
  busyRef.current = !!active;
  useEffect(() => (ready ? startCallPolling(() => busyRef.current) : undefined), [ready]);
  useTick(!!(active || ui), 250);
  const id = active?.id ?? null;
  useEffect(() => { setBusy(false); }, [id, active?.status, active?.askStatus]);
  const showLast = last && !active && last.id !== seen;
  useEffect(() => { if (showLast && (last.askStatus === "APPROVED")) syncGame(); }, [showLast, last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return null;

  async function act(body) {
    if (busy || !active) return;
    setBusy(true);
    const r = await callsDo({ ...body, callId: active.id }, { quiet: false });
    if (body.action === "approve" && r.ok) syncGame();
    setBusy(false);
  }
  let body = null;
  if (active?.role === "callee" && active.status === "RINGING") body = <Ringing c={active} busy={busy} act={act} />;
  else if (ui) body = <HomeCall ui={ui} />;
  else if (active?.status === "RINGING") body = <Outgoing c={active} busy={busy} act={act} />;
  else if (active?.status === "ANSWERED") body = <Connected c={active} busy={busy} act={act} balanceKobo={g?.balanceKobo} />;
  else if (showLast) body = <Result c={last} onDone={() => setSeen(last.id)} />;
  if (!body) return null;
  return <div className="cx-scrim">{body}</div>;
}
