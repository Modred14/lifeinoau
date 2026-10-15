// components/bet/Roulette.js
// European roulette (one zero, 2.70% house edge) with a real table: straight, split, street, corner, column, dozen and even-money bets.
// Tapping Spin starts the wheel and takes your chips at once. The ball lands when the server's answer arrives (and your wallet only
// changes when it lands, so the result is never spoiled). If the server refuses, the chips come back and the wheel stops.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import { call } from "@/lib/client";
import { game, run, cash, canAfford } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { playSound, playReel, holdWallet, releaseWallet, money, moneyK, short } from "@/lib/bet/betClient";
import { WHEEL, REDS, colorOf, coverage, betKey, MAX_STAKE, MAX_BETS } from "@/lib/bet/rouletteMath.js";

const TAU = Math.PI * 2, CHIPS = [100, 500, 1000, 5000, 10000];
const POCKET = Object.fromEntries(WHEEL.map((n, i) => [n, i]));
const pa = (i) => (i * TAU) / 37;
const mod = (x) => ((x % TAU) + TAU) % TAU;
const num = (k, c) => 3 * k + c + 1; // row k (0..11), column c (0..2)
const chipTone = (v) => (v >= 10000 ? "c5" : v >= 5000 ? "c4" : v >= 1000 ? "c3" : v >= 500 ? "c2" : "c1");

/** Where an inside bet's chip sits on the number area, as percentages (x across 3 columns, y down 13 rows with zero on top). */
function spot(type, ref) {
  if (type === "straight") { const n = Number(ref); return n === 0 ? [50, 50 / 13] : [((((n - 1) % 3) + 0.5) / 3) * 100, ((Math.floor((n - 1) / 3) + 1.5) / 13) * 100]; }
  if (type === "split") {
    const [a, b] = String(ref).split("-").map(Number);
    if (a === 0) return [((b - 0.5) / 3) * 100, (1 / 13) * 100];
    const ca = (a - 1) % 3, ka = Math.floor((a - 1) / 3);
    return b - a === 1 ? [((ca + 1) / 3) * 100, ((ka + 1.5) / 13) * 100] : [((ca + 0.5) / 3) * 100, ((ka + 2) / 13) * 100];
  }
  if (type === "street") return [0, ((Math.floor((Number(ref) - 1) / 3) + 1.5) / 13) * 100];
  if (type === "corner") { const n = Number(ref), c = (n - 1) % 3, k = Math.floor((n - 1) / 3); return [((c + 1) / 3) * 100, ((k + 2) / 13) * 100]; }
  if (type === "trio") return [ref === "0-1-2" ? 33.333 : 66.667, (1 / 13) * 100];
  return null;
}

/** Every tappable spot between two cells (splits), at a corner or on a street. Straight bets are the cells themselves. */
function buildHot() {
  const h = [], row = 100 / 13;
  for (let c = 0; c < 3; c++) h.push({ type: "split", ref: `0-${c + 1}`, x: ((c + 0.5) / 3) * 100, y: row, w: 100 / 3 * 0.6, hh: null, tall: false });
  for (let k = 0; k < 12; k++) for (let c = 1; c < 3; c++) h.push({ type: "split", ref: `${num(k, c - 1)}-${num(k, c)}`, x: (c / 3) * 100, y: (k + 1.5) * row, w: null, hh: row * 0.7, wide: false });
  for (let k = 0; k < 11; k++) for (let c = 0; c < 3; c++) h.push({ type: "split", ref: `${num(k, c)}-${num(k + 1, c)}`, x: ((c + 0.5) / 3) * 100, y: (k + 2) * row, w: 100 / 3 * 0.6, hh: null });
  for (let k = 0; k < 12; k++) h.push({ type: "street", ref: String(3 * k + 1), x: 0, y: (k + 1.5) * row, w: null, hh: row * 0.7, edge: true });
  for (let k = 0; k < 11; k++) for (let c = 1; c < 3; c++) h.push({ type: "corner", ref: String(3 * k + c), x: (c / 3) * 100, y: (k + 2) * row, corner: true });
  h.push({ type: "trio", ref: "0-1-2", x: 33.333, y: row, corner: true }, { type: "trio", ref: "0-2-3", x: 66.667, y: row, corner: true });
  return h.sort((a, b) => (a.corner ? 1 : 0) - (b.corner ? 1 : 0) + (a.edge ? 0.5 : 0) - (b.edge ? 0.5 : 0));
}

function drawWheel(cv, s, size, dpr) {
  const ctx = cv.getContext("2d"), ff = getComputedStyle(cv).fontFamily; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
  const c = size / 2, R = c - 3, pt = (r, phi) => [c + r * Math.sin(phi), c - r * Math.cos(phi)];
  const disc = (r, fill, stroke) => { ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); } };
  disc(R, "#1a212c", "#2d384a"); disc(R * 0.93, "#10151c"); disc(R * 0.8, "#10151c");
  const half = TAU / 37 / 2;
  WHEEL.forEach((n, i) => {
    const phi = s.wa + pa(i), col = n === 0 ? "#1e9e5a" : REDS.has(n) ? "#c9283c" : "#161b23";
    ctx.beginPath(); ctx.arc(c, c, R * 0.8, phi - half - Math.PI / 2, phi + half - Math.PI / 2); ctx.arc(c, c, R * 0.53, phi + half - Math.PI / 2, phi - half - Math.PI / 2, true); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = "#caa24a"; ctx.lineWidth = 0.7; ctx.stroke();
    const [x, y] = pt(R * 0.735, phi); ctx.save(); ctx.translate(x, y); ctx.rotate(phi); ctx.fillStyle = "#f2f4f8"; ctx.font = `600 ${Math.round(size * 0.04)}px ${ff}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n), 0, 0); ctx.restore();
  });
  disc(R * 0.53, "#1b222d", "#caa24a"); disc(R * 0.4, "#232c3a"); disc(R * 0.13, "#f4b942");
  ctx.strokeStyle = "#f4b942"; ctx.lineWidth = 3; ctx.lineCap = "round";
  for (let k = 0; k < 4; k++) { const [x1, y1] = pt(R * 0.13, s.wa + (k * TAU) / 4), [x2, y2] = pt(R * 0.36, s.wa + (k * TAU) / 4); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  if (s.show) { const [bx, by] = pt(R * s.br, s.ba); ctx.beginPath(); ctx.arc(bx + 1.2, by + 1.6, size * 0.022, 0, TAU); ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fill(); ctx.beginPath(); ctx.arc(bx, by, size * 0.022, 0, TAU); ctx.fillStyle = "#f7f9fc"; ctx.fill(); }
}

export default function Roulette({ active }) {
  const router = useRouter(), cv = useRef(null), box = useRef(null);
  const sim = useRef({ mode: "idle", wa: 0, wv: 0.25, ba: 0, br: 0.86, pocket: null, show: false, last: 0 });
  const [bets, setBets] = useState([]), [chip, setChip] = useState(500), [busy, setBusy] = useState(false), [hist, setHist] = useState([]);
  const [res, setRes] = useState(null), [hot, setHot] = useState(null), lastBets = useRef([]);
  const hotspots = useMemo(buildHot, []);

  const totals = useMemo(() => { const m = new Map(); for (const b of bets) { const k = betKey(b); m.set(k, { ...b, chip: (m.get(k)?.chip ?? 0) + b.chip }); } return m; }, [bets]);
  const total = bets.reduce((t, b) => t + b.chip, 0);

  useEffect(() => { let on = true; call("/api/bet/roulette").then((r) => { if (on && !r.failed) setHist(r.history ?? []); }); return () => { on = false; }; }, []);

  // the wheel and ball
  useEffect(() => {
    if (!active) return;
    let raf;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const c = cv.current, b = box.current, s = sim.current; if (!c || !b) return;
      const size = Math.min(b.clientWidth, 260), dpr = Math.min(2, window.devicePixelRatio || 1), dt = Math.min(0.05, (t - (s.last || t)) / 1000); s.last = t;
      if (c.width !== Math.round(size * dpr)) { c.width = c.height = Math.round(size * dpr); c.style.width = c.style.height = size + "px"; }
      s.wa += s.wv * dt;
      if (s.mode === "idle") { s.wv += (0.25 - s.wv) * Math.min(1, dt * 1.5); if (s.pocket != null) { s.ba = s.wa + pa(s.pocket); s.br = 0.665; s.show = true; } }
      else if (s.mode === "wait") { s.wv += (1.1 - s.wv) * Math.min(1, dt * 3); s.ba -= 8 * dt; s.br = 0.865; s.show = true; }
      else if (s.mode === "land") {
        const L = s.land, tau = (t - L.t0) / L.D;
        if (tau >= 1) { s.mode = "idle"; s.pocket = L.idx; s.ba = s.wa + pa(L.idx); s.br = 0.665; L.done(); }
        else {
          s.ba = L.b0 + L.delta * (1 - Math.pow(1 - tau, 3.4));
          if (tau < 0.5) s.br = 0.865;
          else if (tau < 0.88) { const u = (tau - 0.5) / 0.38; s.br = 0.665 + 0.2 * (1 - u) * (1 - u); }
          else { const u = (tau - 0.88) / 0.12; s.br = 0.665 + 0.022 * Math.sin(u * Math.PI * 3) * (1 - u); }
        }
      }
      drawWheel(c, s, size, dpr);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const land = useCallback((n, done) => {
    const s = sim.current, idx = POCKET[n], D = 4400, wait = Math.max(0, s.waitStart + 900 - performance.now());
    setTimeout(() => {
      const t0 = performance.now(), w0 = s.wa, b0 = s.ba, B = w0 + s.wv * (D / 1000) + pa(idx);
      s.land = { t0, D, idx, b0, delta: -(TAU + mod(b0 - B)), done }; s.mode = "land"; playReel(D);
    }, wait);
  }, []);

  function add(type, ref) {
    if (busy) return;
    const k = `${type}:${ref}`;
    if (!totals.has(k) && totals.size >= MAX_BETS) return toast.error(`At most ${MAX_BETS} different bets per spin.`, { id: "rtmax" });
    if (total + chip > MAX_STAKE) return toast.error(`The table limit is ${money(MAX_STAKE)} a spin.`, { id: "rtlimit" });
    setRes(null); setBets((b) => [...b, { type, ref: String(ref), chip }]); playSound("tick");
  }

  async function spin() {
    if (busy || !bets.length) return;
    const merged = [...totals.values()], stakeKobo = BigInt(total) * 100n;
    if (!canAfford(stakeKobo)) return toast.error("You do not have enough cash for those chips.", { id: "rtcash" });
    setBusy(true); setRes(null); lastBets.current = bets;
    const s = sim.current; s.mode = "wait"; s.waitStart = performance.now(); s.show = true; // the wheel is already spinning
    const p = run({
      key: "rl:spin", router,
      request: () => call("/api/bet/roulette", { bets: merged.map((b) => ({ type: b.type, ref: b.ref, chip: b.chip })), requestId: crypto.randomUUID() }),
      effects: [{ store: game, patch: cash(-stakeKobo) }],
    });
    holdWallet(game.get()?.balanceKobo ?? "0"); // the chips have left; the winnings stay hidden until the ball lands
    const r = await p;
    if (r.failed || r.duplicate) { s.mode = "idle"; releaseWallet(); setBusy(false); return; } // refused: chips are back and the wheel stops
    land(r.number, () => {
      const paid = BigInt(r.paidKobo), net = paid - stakeKobo;
      setRes({ n: r.number, paid, net, wins: r.wins }); setHist((h) => [r.number, ...h].slice(0, 20)); setBets([]); setBusy(false); releaseWallet();
      if (paid > 0n) { playSound("coin"); toast.success(net > 0n ? `${r.number} ${colorOf(r.number)}. You won ${moneyK(net)}.` : `${r.number} ${colorOf(r.number)}. You got your stake back.`, { id: "rtres" }); }
      else toast.info(`${r.number} ${colorOf(r.number)}. No win this time.`, { id: "rtres" });
    });
  }

  const undo = () => !busy && setBets((b) => b.slice(0, -1)), clear = () => !busy && setBets([]);
  const rebet = () => { if (!busy && lastBets.current.length) { setRes(null); setBets(lastBets.current); } };
  const dbl = () => { if (!busy && bets.length && total * 2 <= MAX_STAKE) setBets((b) => [...b, ...b]); };
  const hl = hot ? new Set(coverage(hot)?.nums ?? []) : null, winN = res?.n;
  const stack = (type, ref) => { const t = totals.get(`${type}:${ref}`); return t ? <i className={`chip ${chipTone(t.chip)}`}>{short(t.chip)}</i> : null; };

  const cell = (n) => (
    <button key={n} type="button" className={`rt-n ${colorOf(n)}${hl?.has(n) ? " hl" : ""}${winN === n ? " win" : ""}`} style={n === 0 ? { gridColumn: "2 / 5", gridRow: 1 } : { gridColumn: 2 + ((n - 1) % 3), gridRow: 2 + Math.floor((n - 1) / 3) }} onClick={() => add("straight", n)} aria-label={`Number ${n}`}>
      <span>{n}</span>{stack("straight", n)}
    </button>
  );
  const side = (type, ref, label, style, cls = "") => <button key={`${type}${ref}`} type="button" className={`rt-o ${cls}`} style={style} onClick={() => add(type, ref)}><span>{label}</span>{stack(type, ref)}</button>;

  return (
    <div className="bt-scroll rt" aria-hidden={!active}>
      <div className="rt-hist" aria-label="Last numbers">{hist.length === 0 ? <small>Last numbers show up here</small> : hist.slice(0, 16).map((n, i) => <span key={i} className={`rn ${colorOf(n)}`}>{n}</span>)}</div>
      <div className="rt-wheel" ref={box}>
        <canvas ref={cv} aria-label="Roulette wheel" />
        <div className={`rt-res${res ? " show" : ""}`} aria-live="polite">
          {res && (<><span className={`rn big ${colorOf(res.n)}`}>{res.n}</span><span>{res.paid > 0n ? (res.net > 0n ? <b className="up">+{moneyK(res.net)}</b> : <b>Stake back</b>) : <b className="dn">No win</b>}</span></>)}
        </div>
      </div>

      <div className={`rt-table${busy ? " busy" : ""}`} aria-label="Betting table">
        <div className="rt-grid">
          {cell(0)}
          {Array.from({ length: 36 }, (_, i) => cell(i + 1))}
          {side("dozen", 1, "1st 12", { gridColumn: 1, gridRow: "2 / 6" }, "v")}
          {side("dozen", 2, "2nd 12", { gridColumn: 1, gridRow: "6 / 10" }, "v")}
          {side("dozen", 3, "3rd 12", { gridColumn: 1, gridRow: "10 / 14" }, "v")}
          {side("even", "low", "1-18", { gridColumn: 5, gridRow: "2 / 4" })}
          {side("even", "even", "Even", { gridColumn: 5, gridRow: "4 / 6" })}
          {side("even", "red", "", { gridColumn: 5, gridRow: "6 / 8" }, "red-o")}
          {side("even", "black", "", { gridColumn: 5, gridRow: "8 / 10" }, "black-o")}
          {side("even", "odd", "Odd", { gridColumn: 5, gridRow: "10 / 12" })}
          {side("even", "high", "19-36", { gridColumn: 5, gridRow: "12 / 14" })}
          {[1, 2, 3].map((c) => side("column", c, "2:1", { gridColumn: 1 + c, gridRow: 14 }, "col"))}
          <div className="rt-hot">
            {hotspots.map((h) => (
              <button key={`${h.type}${h.ref}`} type="button" className={`hs ${h.type}`} aria-label={`${h.type} ${h.ref}`}
                style={{ left: `${h.x}%`, top: `${h.y}%`, width: h.w ? `${h.w}%` : h.corner ? 22 : h.edge ? 16 : 18, height: h.hh ? `${h.hh}%` : h.corner ? 22 : 18 }}
                onPointerEnter={() => setHot(h)} onPointerLeave={() => setHot(null)} onClick={() => add(h.type, h.ref)} />
            ))}
          </div>
          <div className="rt-chips" aria-hidden="true">
            {[...totals.values()].filter((b) => spot(b.type, b.ref)).map((b) => { const [x, y] = spot(b.type, b.ref); return b.type === "straight" ? null : <i key={betKey(b)} className={`chip ${chipTone(b.chip)}`} style={{ left: `${x}%`, top: `${y}%` }}>{short(b.chip)}</i>; })}
          </div>
        </div>
      </div>

      <div className="rt-bar">
        <div className="rt-chipsel" role="radiogroup" aria-label="Chip value">
          {CHIPS.map((v) => <button key={v} type="button" role="radio" aria-checked={chip === v} className={`cs ${chipTone(v)}${chip === v ? " on" : ""}`} onClick={() => setChip(v)}>{short(v)}</button>)}
        </div>
        <div className="rt-act">
          <button type="button" onClick={undo} disabled={busy || !bets.length}><Icon name="undo" size={16} />Undo</button>
          <button type="button" onClick={clear} disabled={busy || !bets.length}><Icon name="trash" size={16} />Clear</button>
          <button type="button" onClick={rebet} disabled={busy || !lastBets.current.length || !!bets.length}><Icon name="repeat" size={16} />Rebet</button>
          <button type="button" onClick={dbl} disabled={busy || !bets.length}>2×</button>
        </div>
        <button type="button" className="bt-primary" onClick={spin} disabled={busy || !bets.length}>{busy ? "Spinning…" : total ? `Spin · ${money(total)}` : "Place a chip to spin"}</button>
      </div>
      <p className="fine">18+ · One zero, so the house keeps 2.7% of everything staked over time. Straight 35:1, split 17:1, street 11:1, corner 8:1, dozen and column 2:1, even money 1:1.</p>
    </div>
  );
}