// components/bet/Aviator.js
// Aviator, the way the real one plays: the plane climbs along an exponential curve and can fly away at ANY moment. Cash out before it does.
// Tapping Bet takes off at once and your stake leaves your wallet at once; tapping Cash out shows your win at once. The server is the
// only referee, and if it disagrees (the plane had already gone) the win is taken back and the screen says why.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import { call } from "@/lib/client";
import { game, run, cash, canAfford } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { setServerNow, playSound, money, moneyK } from "@/lib/bet/betClient";
import { centiAt, secAt, payout, fmtX, tier, MIN_STAKE, MAX_STAKE, RTP } from "@/lib/bet/aviatorMath.js";

const QUICK = [100, 500, 1000, 5000];
const NAMES = ["Tolu", "Chika", "Dami", "Ayo", "Fisayo", "Emeka", "Bisi", "Kunle", "Zainab", "Obi", "Temi", "Seyi", "Amaka", "Yusuf"];
const rnd = (a, b) => a + Math.random() * (b - a);

/** Other players at the table, simulated: each picks a cash-out target from the same law the real crash follows. */
function makeSims() {
  const names = [...NAMES].sort(() => Math.random() - 0.5).slice(0, 7);
  return names.map((n, i) => ({ name: n.slice(0, 2) + "***" + Math.floor(rnd(1, 9)), stake: [200, 300, 500, 1000, 2000, 5000, 10000][Math.floor(rnd(0, 7))], target: Math.min(60, Math.max(1.1, RTP / (1 - Math.random()))), i }));
}

function paint(cv, f, t, w, h, dpr) {
  const ctx = cv.getContext("2d"), ff = getComputedStyle(cv).fontFamily; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); // canvas cannot read CSS variables, so the font comes from the element
  const x0 = 34, y0 = h - 30, Wp = w - x0 - 22, Hp = y0 - 26;
  // slow turning rays behind everything
  ctx.save(); ctx.translate(x0, y0); ctx.rotate(t / 16000);
  for (let i = 0; i < 20; i++) { ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.028)" : "rgba(255,255,255,0)"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 640, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  // axes drawn as dots, like the real game
  ctx.fillStyle = "#2b3444";
  for (let x = x0; x <= w - 12; x += 11) { ctx.beginPath(); ctx.arc(x, y0, 1.4, 0, 7); ctx.fill(); }
  for (let y = y0; y >= 14; y -= 11) { ctx.beginPath(); ctx.arc(x0, y, 1.4, 0, 7); ctx.fill(); }

  const live = f && !f.done, crashed = !!f?.crashShown, secs = live ? ((crashed ? f.crashAt : t) - f.t0) / 1000 : 0, m = crashed ? f.crash / 100 : centiAt(secs) / 100;
  const T = Math.max(6, secs * 1.12), M = Math.max(1.6, m * 1.12);
  const pt = (s) => [x0 + (s / T) * Wp, y0 - ((Math.exp(0.065 * s) - 1) / (M - 1)) * Hp];
  let head = [x0, y0], ang = -0.25;
  if (live && secs > 0.02) {
    const N = 70, pts = []; for (let i = 0; i <= N; i++) pts.push(pt((secs * i) / N));
    ctx.beginPath(); ctx.moveTo(x0, y0); pts.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[N][0], y0); ctx.closePath();
    ctx.fillStyle = crashed ? "rgba(240,69,90,0.10)" : "rgba(240,69,90,0.17)"; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = "#f0455a"; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.stroke();
    head = pts[N]; const q = pts[N - 3]; ang = Math.atan2(head[1] - q[1], head[0] - q[0]);
  }
  // the plane
  let px = head[0], py = head[1], a = ang, alpha = 1;
  if (crashed) { const dt = Math.max(0, t - f.crashShown); px += dt * 0.55; py -= dt * 0.18; alpha = Math.max(0, 1 - dt / 900); }
  else if (!live) { py -= 5 + Math.sin(t / 420) * 3; a = -0.12; }
  if (alpha > 0) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(px, py); ctx.rotate(a); ctx.scale(1.15, 1.15);
    ctx.fillStyle = "#c4283b"; ctx.beginPath(); ctx.moveTo(6, 1); ctx.lineTo(-9, 15); ctx.lineTo(-16, 15); ctx.lineTo(-8, 1); ctx.closePath(); ctx.fill(); // wing
    ctx.fillStyle = "#f0455a"; ctx.beginPath(); ctx.moveTo(-21, -3); ctx.lineTo(-28, -17); ctx.lineTo(-17, -17); ctx.lineTo(-10, -3); ctx.closePath(); ctx.fill(); // tail
    ctx.beginPath(); ctx.roundRect(-24, -6, 50, 12, 6); ctx.fill(); // body
    ctx.fillStyle = "#ffd9de"; ctx.beginPath(); ctx.roundRect(8, -4, 11, 5, 2.5); ctx.fill(); // cockpit
    ctx.restore();
  }
  // the multiplier in the middle
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const mid = [w / 2 + 6, h / 2 - 8];
  if (!f || f.done) { ctx.fillStyle = "#8793a6"; ctx.font = `600 15px ${ff}`; ctx.fillText("Place a bet to take off", mid[0], mid[1]); return; }
  const big = f.cashed && !crashed ? "#f4b942" : crashed ? "#f0455a" : "#ffffff";
  if (crashed) { ctx.fillStyle = "#f0455a"; ctx.font = `700 15px ${ff}`; ctx.fillText("FLEW AWAY", mid[0], mid[1] - 36); }
  ctx.fillStyle = big; ctx.font = `700 58px ${ff}`; ctx.fillText(m.toFixed(2) + "x", mid[0], mid[1]);
}

export default function Aviator({ active }) {
  const router = useRouter(), cv = useRef(null), box = useRef(null), fl = useRef(null), poll = useRef(null), betting = useRef(false);
  const [, bump] = useState(0), rerender = useCallback(() => bump((x) => x + 1), []);
  const [stake, setStake] = useState(1000), [auto, setAuto] = useState({ on: false, x: "2.00" }), [hist, setHist] = useState([]);

  const f = fl.current, flying = f && !f.done && !f.crashShown;
  const nowCenti = () => (f ? (f.crashShown ? f.crash : centiAt((performance.now() - f.t0) / 1000)) : 100);

  const finishRound = useCallback((x, crash) => { // the crash value is known: the plane will fly away when its own clock reaches it
    if (x.crash) return;
    x.crash = crash; x.crashAt = x.t0 + secAt(crash) * 1000;
  }, []);
  const settleFrom = useCallback((x, r) => { // r = a settled round from the server
    if (r.status === "WON" && !x.cashed) { // an automatic cash-out: the server paid it, show it
      x.cashed = { centi: r.cashCenti, payout: BigInt(r.payoutKobo), pending: false };
      game.pushDone(cash(BigInt(r.payoutKobo))); game.scheduleRefresh(); playSound("coin");
    }
    finishRound(x, r.crashCenti);
  }, [finishRound]);

  // The server starts the clock for a flight when it takes the bet. Line the plane up with that clock (once), so the multiplier on screen
  // is the one the server will pay at, instead of a plane that took off a network trip earlier.
  const syncClock = useCallback((x, round, serverNow, rtt = 0) => {
    if (x.synced || !round) return;
    x.synced = true; x.t0 = performance.now() - Math.max(0, serverNow - round.startedAt) - Math.min(400, rtt / 2);
  }, []);

  // ask the server how the flight is going (twice a second while the plane is up)
  const check = useCallback(async () => {
    const x = fl.current; if (!x || x.done || x.crash || x.checking) return;
    x.checking = true;
    const r = await call("/api/bet/aviator"); x.checking = false;
    if (r.failed || fl.current !== x) return;
    setServerNow(r.now);
    if (r.history) setHist(r.history);
    if (r.round && !x.id) { x.id = r.round.id; syncClock(x, r.round, r.now); }
    // Only the result of THIS flight settles it. Before the server has taken the bet, "last" is the PREVIOUS flight: using it would end the new
    // plane at the old crash point and pay out the old win a second time.
    if (!r.round && r.last && x.id && r.last.id === x.id) settleFrom(x, r.last);
  }, [settleFrom, syncClock]);

  // load history, and pick up a flight that was in the air when the app was closed
  useEffect(() => {
    let on = true;
    (async () => {
      const r = await call("/api/bet/aviator"); if (!on || r.failed) return;
      setServerNow(r.now); setHist(r.history ?? []);
      if (r.round && !fl.current) {
        const age = Math.max(0, r.now - r.round.startedAt);
        fl.current = { id: r.round.id, synced: true, t0: performance.now() - age, stake: Number(BigInt(r.round.stakeKobo) / 100n), stakeKobo: BigInt(r.round.stakeKobo), autoCenti: r.round.autoCenti, cashed: null, crash: null, sims: makeSims() };
        rerender();
      }
    })();
    return () => { on = false; };
  }, [rerender]);

  // the animation loop, and a slower tick for the buttons
  useEffect(() => {
    if (!active) return;
    let raf, last = 0;
    const loop = (t) => {
      const c = cv.current, b = box.current, x = fl.current; raf = requestAnimationFrame(loop);
      if (!c || !b) return;
      const w = b.clientWidth, h = b.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const p = performance.now();
      if (x && !x.done) {
        if (x.crash && !x.crashShown && p >= x.crashAt) { // flies away now
          x.crashShown = p; x.crashAt = Math.min(x.crashAt, p); playSound(x.cashed ? "pop" : "warn");
          if (!x.cashed) toast.info(`Flew away at ${fmtX(x.crash)}`, { id: "avcrash" });
          setHist((h0) => [{ id: x.id ?? String(p), crashCenti: x.crash, won: !!x.cashed, cashCenti: x.cashed?.centi ?? null }, ...h0.filter((e) => e.id !== x.id)].slice(0, 24));
          rerender();
        }
        if (x.crashShown && p - x.crashShown > 3200) { x.done = true; rerender(); }
        // the plane reached the auto cash-out: ask the server to confirm it straight away
        if (!x.crash && !x.cashed && x.autoCenti && centiAt((p - x.t0) / 1000) >= x.autoCenti && !x.autoAsked) { x.autoAsked = true; x.checking = false; check(); }
      }
      paint(c, x, p, w, h, dpr);
      if (p - last > 110) { last = p; if (x && !x.done) rerender(); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, check, rerender]);

  useEffect(() => { // check on the flight about twice a second
    poll.current = setInterval(() => { const x = fl.current; if (x && !x.done && !x.crash) check(); }, 400);
    return () => clearInterval(poll.current);
  }, [check]);

  async function bet() {
    const cur = fl.current;
    if (betting.current || (cur && !cur.done && !cur.crashShown)) return; // read live, not from the last render: two quick taps must make ONE bet
    const n = Math.floor(Number(stake));
    if (!Number.isInteger(n) || n < MIN_STAKE || n > MAX_STAKE) return toast.error(`Stake between ${money(MIN_STAKE)} and ${money(MAX_STAKE)}.`, { id: "avstake" });
    let autoX = null;
    if (auto.on) { autoX = Number(auto.x); if (!(autoX >= 1.01 && autoX <= 1000)) return toast.error("Auto cash-out must be between 1.01x and 1000x.", { id: "avauto" }); }
    const stakeKobo = BigInt(n) * 100n;
    if (!canAfford(stakeKobo)) return toast.error("You do not have enough cash for that stake.", { id: "avcash" });
    betting.current = true;
    const x = { id: null, t0: performance.now(), stake: n, stakeKobo, autoCenti: autoX ? Math.round(autoX * 100) : null, cashed: null, crash: null, sims: makeSims(), key: crypto.randomUUID() };
    fl.current = x; rerender(); // the plane is already climbing and the stake is already off your wallet (below)
    const sent = performance.now();
    let res;
    try {
      res = await run({
        key: "av:bet", router,
        request: () => call("/api/bet/aviator", { stakeNaira: n, autoCashout: autoX ?? undefined, requestId: x.key }),
        effects: [{ store: game, patch: cash(-stakeKobo) }],
      });
    } finally { betting.current = false; }
    if (res.skipped) return; // the same bet is already on its way: leave that flight alone
    if (res.round) { // taken (or taken earlier: a repeat of the same request answers with the flight it started)
      x.id = res.round.id; syncClock(x, res.round, res.now ?? res.round.startedAt, performance.now() - sent);
      if (res.duplicate) game.scheduleRefresh();
      if (x.queued) sendCash(x);
      return;
    }
    if (res.failed && res.unknown) return recover(x); // no answer at all: the bet may have gone through, so find out before taking the plane down
    toast.dismiss("avwin");
    if (fl.current === x) fl.current = null; // refused: the plane lands and the stake is back
    if (res.duplicate) game.scheduleRefresh(); // an earlier try of this bet had already been settled: the balance catches up
    rerender();
  }

  /** The bet's answer never came. Ask the server whether a flight exists; if so, carry on with it, otherwise land the plane. */
  async function recover(x) {
    for (let i = 0; i < 4 && fl.current === x; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      const r = await call("/api/bet/aviator");
      if (r.failed) continue;
      setServerNow(r.now);
      if (r.round) { x.id = r.round.id; syncClock(x, r.round, r.now); game.scheduleRefresh(); rerender(); if (x.queued) sendCash(x); return; }
      break;
    }
    toast.dismiss("avwin");
    if (fl.current === x) { fl.current = null; rerender(); }
    game.scheduleRefresh();
  }

  /** The cash-out's answer never came. Find out what the server did, and put the screen in line with it. */
  async function confirmCash(x) {
    for (let i = 0; i < 5 && fl.current === x; i++) {
      await new Promise((r) => setTimeout(r, 900));
      const r = await call("/api/bet/aviator");
      if (r.failed) continue;
      setServerNow(r.now);
      if (r.round && r.round.id === x.id) { x.cashed = null; toast.dismiss("avwin"); toast.error("Your cash-out did not go through. Try again.", { id: "avwin" }); rerender(); return; } // still in the air: it never arrived
      if (r.last && r.last.id === x.id) { x.cashed = null; toast.dismiss("avwin"); settleFrom(x, r.last); if (x.cashed) toast.success(`Cashed out at ${fmtX(x.cashed.centi)}: +${moneyK(x.cashed.payout - x.stakeKobo)}`, { id: "avwin" }); game.scheduleRefresh(); rerender(); return; }
    }
  }

  async function sendCash(x) {
    const pay = x.cashed.payout;
    const res = await run({
      key: `av:cash:${x.id}`, router,
      request: () => call("/api/bet/aviator", { action: "cashout", roundId: x.id }),
      effects: [{ store: game, patch: cash(pay) }],
    });
    if (res.skipped) return; // this cash-out is already on its way
    if (res.failed && (res.unknown || res.offline || res.timedOut)) return confirmCash(x); // outcome unknown: ask the server, never guess
    if (res.failed || res.round?.status === "LOST") { // too late (or refused): the win is taken back and the real crash shows
      toast.dismiss("avwin");
      x.cashed = null; if (res.round?.crashCenti) finishRound(x, res.round.crashCenti);
    } else if (res.round?.status === "WON") {
      x.cashed = { centi: res.round.cashCenti, payout: BigInt(res.round.payoutKobo), pending: false };
      playSound("coin");
      toast.success(`Cashed out at ${fmtX(res.round.cashCenti)}: +${moneyK(BigInt(res.round.payoutKobo) - x.stakeKobo)}`, { id: "avwin" });
      finishRound(x, res.round.crashCenti);
    } else if (res.replayed) { // an earlier try of this cash-out went through (its answer was lost): the real numbers come from the next check
      x.cashed = { ...x.cashed, pending: false };
      toast.info("Cashed out. Your balance is refreshing.", { id: "avwin" });
      x.checking = false; check();
    } else toast.dismiss("avwin");
    rerender();
  }
  function cashOut() {
    const x = fl.current; if (!x || x.crash || x.cashed || x.done) return;
    const centi = centiAt((performance.now() - x.t0) / 1000), pay = payout(x.stakeKobo, centi);
    x.cashed = { centi, payout: pay, pending: true };
    toast.pending(`Cashing out at ${fmtX(centi)}…`, { id: "avwin" }); // the win is only announced once the server has confirmed it was not too late
    rerender();
    if (x.id) sendCash(x); else x.queued = true; // the bet is still on its way: the cash-out follows it
  }

  const centi = nowCenti(), live = f && !f.done;
  const canCash = f && !f.crashShown && !f.crash && !f.cashed, waitingAuto = f && f.autoAsked && !f.cashed && !f.crash;
  const adj = (m) => setStake((s) => Math.max(MIN_STAKE, Math.min(MAX_STAKE, Math.round(m(Number(s) || 0)))));

  return (
    <div className="bt-scroll av" aria-hidden={!active}>
      <div className="av-hist" aria-label="Recent flights">
        {hist.length === 0 ? <small>Your flights show up here</small> : hist.slice(0, 14).map((h) => <span key={h.id} className={`hx ${tier(h.crashCenti)}`}>{fmtX(h.crashCenti)}</span>)}
      </div>
      <div className="av-stage" ref={box}><canvas ref={cv} aria-label="Aviator flight" /></div>

      <div className="av-ctl">
        <div className="av-stake">
          <button type="button" className="rd" disabled={flying} onClick={() => adj((s) => s - (s > 1000 ? 500 : 100))} aria-label="Lower stake"><Icon name="minus" size={16} weight="bold" /></button>
          <div className="inp-wrap"><span>₦</span><input className="inp" type="text" inputMode="numeric" disabled={flying} value={Number(stake) ? Number(stake).toLocaleString("en-NG") : ""} placeholder="0" onChange={(e) => setStake(Number(e.target.value.replace(/\D/g, "")) || 0)} aria-label="Stake" /></div>
          <button type="button" className="rd" disabled={flying} onClick={() => adj((s) => s + (s >= 1000 ? 500 : 100))} aria-label="Raise stake"><Icon name="plus" size={16} weight="bold" /></button>
        </div>
        <div className="qk">
          {QUICK.map((q) => <button key={q} type="button" disabled={flying} onClick={() => setStake(q)}>{money(q)}</button>)}
          <button type="button" disabled={flying} onClick={() => adj((s) => s / 2)}>½</button>
          <button type="button" disabled={flying} onClick={() => adj((s) => s * 2)}>2×</button>
        </div>
        <div className="av-auto">
          <button type="button" role="switch" aria-checked={auto.on} className={`sw${auto.on ? " on" : ""}`} disabled={flying} onClick={() => setAuto({ ...auto, on: !auto.on })}><i /></button>
          <span>Auto cash out at</span>
          <div className="inp-wrap sm"><input className="inp" type="text" inputMode="decimal" disabled={flying || !auto.on} value={auto.x} onChange={(e) => setAuto({ ...auto, x: e.target.value.replace(/[^\d.]/g, "").slice(0, 7) })} aria-label="Auto cash-out multiplier" /><span>x</span></div>
        </div>

        {canCash ? (
          <button type="button" className="av-go cash" onClick={cashOut} disabled={waitingAuto}>
            {waitingAuto ? "Cashing out…" : <><small>Cash out</small><b className="num">{moneyK(payout(f.stakeKobo, centi))}</b></>}
          </button>
        ) : live && f.cashed && !f.crashShown ? (
          <button type="button" className="av-go done" disabled><small>Cashed out at {fmtX(f.cashed.centi)}</small><b className="num">+{moneyK(f.cashed.payout - f.stakeKobo)}</b></button>
        ) : (
          <button type="button" className="av-go bet" onClick={bet} disabled={flying}>
            <small>{f?.crashShown && f.cashed ? `Won ${moneyK(f.cashed.payout - f.stakeKobo)} · go again` : f?.crashShown ? `Lost ${money(f.stake)} · go again` : "Bet"}</small><b className="num">{money(Number(stake) || 0)}</b>
          </button>
        )}
      </div>

      <section className="av-feed">
        <h4>Players <small>simulated</small></h4>
        {(f?.sims ?? makeSims0).map((s) => {
          const limit = f?.crash ? f.crash - 1 : centi, out = f && s.target * 100 <= limit && f && !f.done, lost = f && f.crashShown && !out;
          return (
            <div key={s.name} className={`pl${out ? " won" : lost ? " lost" : ""}`}>
              <span className="pl-a">{s.name[0]}</span><span className="pl-n">{s.name}</span><span className="pl-b num">{money(s.stake)}</span>
              <span className="pl-x num">{out ? `${s.target.toFixed(2)}x` : lost ? "–" : ""}</span>
              <span className="pl-w num">{out ? `+${money(Math.round(s.stake * s.target - s.stake))}` : ""}</span>
            </div>
          );
        })}
      </section>
      <p className="fine">18+ · Each flight pays back about {Math.round(RTP * 100)}% over time, and about half end before 2x. Cash out early, or lose the stake.</p>
    </div>
  );
}
const makeSims0 = [];