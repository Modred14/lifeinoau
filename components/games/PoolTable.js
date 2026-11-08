// components/games/PoolTable.js: 8-ball pool. The table is drawn standing up (the long side runs down the phone). You place the cue ball when you have it in hand, drag on the table to aim,
// then either drag the cue stick BACK (how far you pull is the power) and let go to shoot, or set the power on the left, the spin on the right and press Shoot. The SERVER runs the shot and sends back a recording; both screens play that recording, so nobody can see a different shot or claim a ball.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TABLE, POCKETS, HEAD } from "@/lib/games/pool";
import { seatName } from "@/lib/games/gamesClient";
import { FIRE_MIN, powerToPull, pullToPower, aimAngle, backDistance, onCue, cueSegment, pullFor, clamp } from "./poolAim";
import "./pool.css";

const TOUCH_REACH = 30; // px: how near the stick a finger must land to grab it

const R = TABLE.r, MARGIN = 36, FRAME_MS = 50; // one recorded frame is 30 physics steps of 1/600 s
const COLORS = ["#f7f5ee", "#f2c230", "#2b5fd0", "#d63a32", "#6a3a9a", "#ee7b1f", "#1f8a4c", "#8a2630", "#15171c"]; // cue, 1..8 (9..15 reuse 1..7)
const colorOf = (n) => COLORS[n === 0 ? 0 : n <= 8 ? n : n - 8];

function drawBall(g, n, x, y, r, alpha = 1) {
  g.save(); g.globalAlpha = alpha; g.translate(x, y);
  g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.ellipse(r * 0.18, r * 0.28, r, r * 0.92, 0, 0, 7); g.fill();
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.save(); g.clip();
  g.fillStyle = n >= 9 ? "#f7f5ee" : colorOf(n); g.fillRect(-r, -r, 2 * r, 2 * r);
  if (n >= 9) { g.fillStyle = colorOf(n); g.fillRect(-r, -r * 0.52, 2 * r, r * 1.04); }
  g.restore();
  if (n > 0) { g.fillStyle = "#fffdf4"; g.beginPath(); g.arc(0, 0, r * 0.46, 0, 7); g.fill(); g.fillStyle = "#15171c"; g.font = `700 ${Math.round(r * 0.62)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 0, r * 0.04); }
  const hi = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, -r * 0.2, -r * 0.2, r * 1.1); hi.addColorStop(0, "rgba(255,255,255,.55)"); hi.addColorStop(0.35, "rgba(255,255,255,0)"); hi.addColorStop(1, "rgba(0,0,0,.22)");
  g.fillStyle = hi; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.restore();
}

/** Where the cue ball first touches something along a line (a ball: contact at 2R; a cushion: where the ball's edge meets it). */
function firstContact(balls, from, ang) {
  const dx = Math.cos(ang), dy = Math.sin(ang); let best = { t: Infinity, hit: null };
  balls.forEach((b, n) => {
    if (n === 0 || !b || b.in) return;
    const fx = b.x - from.x, fy = b.y - from.y, p = fx * dx + fy * dy; if (p <= 0) return;
    const d2 = fx * fx + fy * fy - p * p; if (d2 > 4 * R * R) return;
    const t = p - Math.sqrt(4 * R * R - d2); if (t >= 0 && t < best.t) best = { t, hit: n };
  });
  const wall = [dx > 0 ? (TABLE.w - R - from.x) / dx : dx < 0 ? (R - from.x) / dx : Infinity, dy > 0 ? (TABLE.h - R - from.y) / dy : dy < 0 ? (R - from.y) / dy : Infinity];
  const tw = Math.min(...wall); if (tw < best.t) best = { t: tw, hit: null };
  return { ...best, x: from.x + dx * best.t, y: from.y + dy * best.t };
}


/** A vertical slider driven by pointer events (a native <input type=range> cannot be made vertical and touch-safe everywhere). `origin` is the value the fill grows from. */
function VSlider({ value, min, max, step, origin = min, onChange, disabled, label, text, snap = 0 }) {
  const ref = useRef(null), span = max - min, f = (value - min) / span, f0 = (origin - min) / span;
  const set = (e) => {
    const r = ref.current.getBoundingClientRect(); let v = min + clamp(1 - (e.clientY - r.top) / r.height, 0, 1) * span;
    v = Math.round(v / step) * step; if (snap && Math.abs(v - origin) < snap) v = origin; onChange(clamp(v, min, max));
  };
  const down = (e) => { if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return; e.currentTarget.setPointerCapture?.(e.pointerId); set(e); };
  const move = (e) => { if (!disabled && e.currentTarget.hasPointerCapture?.(e.pointerId)) set(e); };
  const key = (e) => {
    if (disabled) return; const d = { ArrowUp: step * 5, ArrowRight: step * 5, ArrowDown: -step * 5, ArrowLeft: -step * 5, PageUp: span / 5, PageDown: -span / 5 }[e.key];
    if (e.key === "Home") onChange(min); else if (e.key === "End") onChange(max); else if (d) onChange(clamp(Math.round((value + d) / step) * step, min, max)); else return; e.preventDefault();
  };
  return (
    <div ref={ref} className="pool-vs" role="slider" tabIndex={disabled ? -1 : 0} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100} aria-valuetext={text} aria-label={label} aria-disabled={disabled || undefined}
      data-disabled={disabled ? "1" : undefined} onPointerDown={down} onPointerMove={move} onKeyDown={key}>
      <i className="pool-vs-fill" style={{ bottom: `${Math.min(f, f0) * 100}%`, height: `${Math.abs(f - f0) * 100}%` }} />
      <i className="pool-vs-thumb" style={{ bottom: `${f * 100}%` }} />
    </div>
  );
}

export default function PoolTable({ m, b, act, busy }) {
  const cv = useRef(null), wrap = useRef(null), [W, setW] = useState(240);
  const [aim, setAim] = useState(0), [power, setPower] = useState(0.55), [spin, setSpin] = useState(0), [mode, setMode] = useState("aim"), [cuePos, setCuePos] = useState(null);
  const [pulling, setPulling] = useState(false); // the stick is being dragged back right now
  const [play, setPlay] = useState(null); // { frames, t0 } while a recorded shot is being shown
  const seenV = useRef(b.last?.v ?? 0), frameRef = useRef(null), raf = useRef(0), gesture = useRef(null), firing = useRef(false);
  const mine = m.yourTurn && !busy && m.status === "ACTIVE" && !play;
  const k = W / (TABLE.h + 2 * MARGIN), H = (TABLE.w + 2 * MARGIN) * k;
  const toScreen = useCallback((x, y) => [(TABLE.h - y + MARGIN) * k, (x + MARGIN) * k], [k]);
  const toTable = useCallback((sx, sy) => [sy / k - MARGIN, TABLE.h + MARGIN - sx / k], [k]);

  useEffect(() => { const e = wrap.current; if (!e) return; const size = () => setW(Math.max(180, Math.floor(e.clientWidth))); const ro = new ResizeObserver(size); ro.observe(e); size(); return () => ro.disconnect(); }, []);
  // a finger on the table or a control must never scroll the page, pull to refresh or pinch-zoom it (touch-action covers modern browsers; this covers the rest)
  useEffect(() => {
    const root = wrap.current?.closest(".pool"); if (!root) return;
    const stop = (e) => { if (e.target.closest?.(".pool-cv, .pool-vs")) e.preventDefault(); };
    root.addEventListener("touchmove", stop, { passive: false }); root.addEventListener("gesturestart", stop, { passive: false });
    return () => { root.removeEventListener("touchmove", stop); root.removeEventListener("gesturestart", stop); };
  }, []);
  // a shot this screen has not shown yet: play its recording
  useEffect(() => {
    const l = b.last; if (!l) return;
    if (l.frames && l.v > seenV.current) { seenV.current = l.v; frameRef.current = l.frames; setPlay({ frames: l.frames, t0: performance.now() }); }
    else if (l.v > seenV.current) seenV.current = l.v; // (no recording was sent: just show where the balls are)
  }, [b.last]);
  const cue = b.ballInHand ? cuePos ?? (b.balls[0].in ? { x: b.breakShot ? HEAD * 0.6 : 250, y: 250 } : { x: b.balls[0].x, y: b.balls[0].y }) : b.balls[0];
  useEffect(() => { if (b.ballInHand && m.yourTurn) setMode("place"); else setMode("aim"); if (!b.ballInHand) setCuePos(null); }, [b.ballInHand, b.shots, m.yourTurn]);
  // aim at the first ball by default when it is your shot
  useEffect(() => { if (m.yourTurn && !b.ballInHand) { const t = b.balls.findIndex((x, n) => n > 0 && !x.in); if (t > 0) setAim(Math.atan2(b.balls[t].y - b.balls[0].y, b.balls[t].x - b.balls[0].x)); } }, [m.yourTurn, b.shots]); // eslint-disable-line react-hooks/exhaustive-deps
  // a shot is sent once: free the button again when the answer is in (or the turn moved on)
  useEffect(() => { if (!busy) firing.current = false; }, [busy, b.shots, m.yourTurn]);
  // losing the turn (or the shot starting to play) mid-drag drops the gesture
  useEffect(() => { if (!mine && gesture.current) { gesture.current = null; setPulling(false); } }, [mine]);

  const frame = useCallback((now) => {
    const g = cv.current?.getContext("2d"); if (!g) return;
    const dpr = window.devicePixelRatio || 1, cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (cv.current.width !== cw || cv.current.height !== ch) { cv.current.width = cw; cv.current.height = ch; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    // frame, felt, cushions, pockets
    g.fillStyle = "#4a2c17"; g.beginPath(); g.roundRect(0, 0, W, H, 14 * k); g.fill();
    g.fillStyle = "#6b4226"; g.beginPath(); g.roundRect(3 * k, 3 * k, W - 6 * k, H - 6 * k, 12 * k); g.fill();
    const fx = MARGIN * k - 8 * k; g.fillStyle = "#17734a"; g.fillRect(fx, fx, W - 2 * fx, H - 2 * fx);
    g.strokeStyle = "#0e5a37"; g.lineWidth = 8 * k; g.strokeRect(fx + 4 * k, fx + 4 * k, W - 2 * fx - 8 * k, H - 2 * fx - 8 * k);
    g.fillStyle = "#e9d8a6"; for (let i = 1; i < 8; i++) for (const s of [-1, 1]) { const x = (TABLE.w * i) / 8; const [px, py] = toScreen(x, s < 0 ? -MARGIN / 2 : TABLE.h + MARGIN / 2); g.beginPath(); g.arc(px, py, 2.4 * k, 0, 7); g.fill(); }
    for (let i = 1; i < 4; i++) for (const x of [-MARGIN / 2, TABLE.w + MARGIN / 2]) { const [px, py] = toScreen(x, (TABLE.h * i) / 4); g.beginPath(); g.arc(px, py, 2.4 * k, 0, 7); g.fill(); }
    for (const [px, py, pr] of POCKETS) { const [sx, sy] = toScreen(px, py); g.fillStyle = "#06090b"; g.beginPath(); g.arc(sx, sy, (pr + 2) * k, 0, 7); g.fill(); }
    if (b.breakShot && mine && b.ballInHand) { const [a1, a2] = [toScreen(HEAD, 0), toScreen(HEAD, TABLE.h)]; g.strokeStyle = "rgba(255,255,255,.28)"; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(a1[0], a1[1]); g.lineTo(a2[0], a2[1]); g.stroke(); g.setLineDash([]); }
    // the balls: either the recording being played, or where they stand now
    let pos = b.balls.map((x, n) => (n === 0 && b.ballInHand ? { ...cue, in: false } : x));
    let fade = null;
    if (play) {
      const f = play.frames, ft = (now - play.t0) / FRAME_MS, i = Math.min(f.length - 1, Math.floor(ft)), u = Math.min(1, ft - i), A = f[i], B = f[Math.min(f.length - 1, i + 1)];
      pos = []; fade = [];
      for (let n = 0; n < 16; n++) {
        const ax = A[n * 2], bx = B[n * 2];
        if (ax < 0) { pos.push({ in: true }); fade.push(1); continue; }
        if (bx < 0) { pos.push({ x: ax / 10, y: A[n * 2 + 1] / 10, in: false }); fade.push(1 - u); continue; }
        pos.push({ x: (ax + (bx - ax) * u) / 10, y: (A[n * 2 + 1] + (B[n * 2 + 1] - A[n * 2 + 1]) * u) / 10, in: false }); fade.push(1);
      }
      if (ft >= f.length - 1 + 2) { setPlay(null); return; }
    }
    const aiming = mine && mode === "aim" && cue && !cue.in;
    // aiming line for the player to move
    if (aiming) {
      const hit = firstContact(b.balls, cue, aim), [sx, sy] = toScreen(cue.x, cue.y), [ex, ey] = toScreen(hit.x, hit.y);
      g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 1.6; g.setLineDash([7, 6]); g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      g.strokeStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.arc(ex, ey, R * k, 0, 7); g.stroke();
      if (hit.hit) { const o = b.balls[hit.hit], da = Math.atan2(o.y - hit.y, o.x - hit.x), [ox, oy] = toScreen(o.x, o.y), [tx, ty] = toScreen(o.x + Math.cos(da) * 90, o.y + Math.sin(da) * 90); g.strokeStyle = "rgba(255,225,120,.9)"; g.beginPath(); g.moveTo(ox, oy); g.lineTo(tx, ty); g.stroke(); }
    }
    for (let n = 15; n >= 0; n--) { const p = pos[n]; if (!p || p.in) continue; const [sx, sy] = toScreen(p.x, p.y); drawBall(g, n, sx, sy, R * k, fade ? fade[n] : 1); }
    // the cue stick, over the cloth behind the ball: a tapered stick that slides back as the power grows (flat colours, drawn from the same segment the touch test uses)
    if (aiming) {
      const [[tx, ty], [bx, by]] = cueSegment(cue, aim, R, powerToPull(power)), [x0, y0] = toScreen(tx, ty), [x1, y1] = toScreen(bx, by), len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      const w0 = Math.max(2.2, 4 * k * 2), w1 = w0 * 2.1, tip = Math.max(5, len * 0.045);
      g.fillStyle = "#e6c88e"; g.beginPath(); g.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2); g.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2); g.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2); g.lineTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2); g.closePath(); g.fill();
      const tx1 = x0 + ((x1 - x0) / len) * tip, ty1 = y0 + ((y1 - y0) / len) * tip; g.strokeStyle = "#3a6fb0"; g.lineWidth = w0; g.lineCap = "butt"; g.beginPath(); g.moveTo(x0, y0); g.lineTo(tx1, ty1); g.stroke();
      g.strokeStyle = pulling ? "#ffe27a" : "rgba(0,0,0,.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2); g.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2); g.moveTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2); g.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2); g.stroke();
    }
    if (mine && mode === "place") { const [sx, sy] = toScreen(cue.x, cue.y); g.strokeStyle = "#ffe27a"; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, R * k + 4, 0, 7); g.stroke(); }
  }, [W, H, k, b, cue, aim, power, mode, mine, play, pulling, toScreen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const loop = (now) => { frame(now); raf.current = requestAnimationFrame(loop); }; raf.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf.current); }, [frame]);

  const point = (e) => { const r = cv.current.getBoundingClientRect(); return toTable((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)); };
  const placeAt = (x, y) => {
    const maxX = b.breakShot ? HEAD : TABLE.w - R, cx = Math.min(maxX, Math.max(R, x)), cy = Math.min(TABLE.h - R, Math.max(R, y));
    if (b.balls.some((o, n) => n > 0 && !o.in && Math.hypot(o.x - cx, o.y - cy) < 2 * R + 0.5)) return;
    setCuePos({ x: cx, y: cy });
  };
  const shoot = (p = power) => {
    if (!mine || firing.current) return; firing.current = true;
    act({ type: "shot", angle: aim, power: p, spin, ...(b.ballInHand ? { cue: { x: cue.x, y: cue.y } } : {}) });
  };
  // Pointer gestures on the table. A touch that lands ON the stick (behind the cue ball) starts a PULL: the stick follows the finger back along its own line, how far is the power, and
  // letting go fires. Anywhere else it AIMS (and placing the cue ball in hand). Which one it is is decided once, at the start, and kept until the finger lifts.
  const down = (e) => {
    if (!mine || (e.pointerType === "mouse" && e.button !== 0) || gesture.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId); const p = point(e);
    if (mode === "place") { gesture.current = { kind: "place", id: e.pointerId }; placeAt(p[0], p[1]); return; }
    const reach = TOUCH_REACH / k, pull = powerToPull(power);
    if (backDistance(cue, aim, p) > R && onCue(cue, aim, R, pull, p, reach)) { gesture.current = { kind: "pull", id: e.pointerId, grab: backDistance(cue, aim, p), pull0: pull, power0: power }; setPulling(true); return; }
    gesture.current = { kind: "aim", id: e.pointerId }; setAim((a) => aimAngle(cue, p, a));
  };
  const move = (e) => {
    const gs = gesture.current; if (!gs || gs.id !== e.pointerId || !mine) return; const p = point(e);
    if (gs.kind === "place") placeAt(p[0], p[1]);
    else if (gs.kind === "aim") setAim((a) => aimAngle(cue, p, a));
    else setPower(pullToPower(pullFor(cue, aim, p, gs.grab, gs.pull0)));
  };
  const up = (e) => {
    const gs = gesture.current; if (!gs || gs.id !== e.pointerId) return; gesture.current = null; setPulling(false);
    if (gs.kind !== "pull") return;
    const final = e.type === "pointerup" ? pullToPower(pullFor(cue, aim, point(e), gs.grab, gs.pull0)) : 0; // from the finger's own last position, not from state that may not have re-rendered yet
    if (final >= FIRE_MIN) { setPower(final); shoot(final); } else setPower(gs.power0); // lifted at the ball (or cancelled by the system): no shot, the power goes back to what it was
  };
  const mineGroup = b.groups[m.seat], theirGroup = b.groups[1 - m.seat];
  const tray = (g) => (g ? [...Array(7)].map((_, i) => (g === "solid" ? i + 1 : i + 9)) : []).map((n) => <i key={n} className="pool-mini" data-out={b.balls[n].in ? "1" : undefined} style={{ "--c": colorOf(n) }} data-stripe={n >= 9 ? "1" : undefined}>{n}</i>);
  const spinText = spin < -0.15 ? "Draw" : spin > 0.15 ? "Follow" : "None", off = !mine;
  return (
    <div className="pool">
      <div className="pool-groups" aria-label="Ball groups">
        <div><span>{seatName(m, 1 - m.seat)}</span><div className="pool-tray">{theirGroup ? tray(theirGroup) : <small>open table</small>}</div></div>
        <div><span>You</span><div className="pool-tray">{mineGroup ? tray(mineGroup) : <small>open table</small>}</div></div>
      </div>
      <div className="pool-row">
        <div className="pool-side" data-off={off ? "1" : undefined}>
          <span className="pool-cap">Power</span>
          <VSlider value={power} min={0} max={1} step={0.01} disabled={off} label="Shot power" text={`${Math.round(power * 100)} percent`} onChange={setPower} />
          <b className="num pool-read">{Math.round(power * 100)}%</b>
        </div>
        <div className="pool-wrap" ref={wrap}>
          <canvas ref={cv} className="pool-cv" style={{ width: W, height: H }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={(e) => e.preventDefault()} aria-label="Pool table" role="img" />
        </div>
        <div className="pool-side" data-off={off ? "1" : undefined}>
          <span className="pool-cap">Spin</span>
          <small className="pool-end">Follow</small>
          <VSlider value={spin} min={-1} max={1} step={0.05} origin={0} snap={0.08} disabled={off} label="Spin: follow above, draw below" text={spinText} onChange={setSpin} />
          <small className="pool-end">Draw</small>
          <button type="button" className="pool-read pool-spin" disabled={off || spin === 0} onClick={() => setSpin(0)} aria-label={spin === 0 ? "No spin" : `${spinText}. Reset spin`}>{spinText}</button>
        </div>
      </div>
      <p className="gm-note" role="status">{play ? "…" : b.msg}</p>
      {mine && (
        <div className="pool-ctl">
          {b.ballInHand && <div className="pool-modes"><button type="button" className="gm-chip" data-on={mode === "place" ? "1" : undefined} onClick={() => setMode("place")}>Place cue ball</button><button type="button" className="gm-chip" data-on={mode === "aim" ? "1" : undefined} onClick={() => setMode("aim")}>Aim</button></div>}
          <button type="button" className="gm-btn gm-btn-go" onClick={() => shoot()}>Shoot</button>
          <p className="gm-note">{mode === "place" ? "Drag on the table to place the cue ball" + (b.breakShot ? " behind the line." : ".") : "Drag on the table to aim. Drag the stick back and let go to shoot: the further back, the harder."}</p>
        </div>
      )}
      {!mine && m.status === "ACTIVE" && !m.yourTurn && !play && <p className="gm-note">{seatName(m, b.turn)} is lining up a shot…</p>}
    </div>
  );
}
