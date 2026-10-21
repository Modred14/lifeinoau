// components/games/PoolTable.js: 8-ball pool. The table is drawn standing up (the long side runs down the phone). You place the cue ball when you have it in hand, drag to aim,
// pick the power and shoot. The SERVER runs the shot and sends back a recording; both screens play that recording, so nobody can see a different shot or claim a ball.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TABLE, POCKETS, HEAD } from "@/lib/games/pool";
import { seatName } from "@/lib/games/gamesClient";

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

export default function PoolTable({ m, b, act, busy }) {
  const cv = useRef(null), wrap = useRef(null), [W, setW] = useState(320);
  const [aim, setAim] = useState(0), [power, setPower] = useState(0.55), [spin, setSpin] = useState(0), [mode, setMode] = useState("aim"), [cuePos, setCuePos] = useState(null);
  const [play, setPlay] = useState(null); // { frames, t0 } while a recorded shot is being shown
  const seenV = useRef(b.last?.v ?? 0), frameRef = useRef(null), raf = useRef(0);
  const mine = m.yourTurn && !busy && m.status === "ACTIVE" && !play;
  const k = W / (TABLE.h + 2 * MARGIN), H = (TABLE.w + 2 * MARGIN) * k;
  const toScreen = useCallback((x, y) => [(TABLE.h - y + MARGIN) * k, (x + MARGIN) * k], [k]);
  const toTable = useCallback((sx, sy) => [sy / k - MARGIN, TABLE.h + MARGIN - sx / k], [k]);

  useEffect(() => { const e = wrap.current; if (!e) return; const ro = new ResizeObserver(() => setW(Math.max(240, Math.floor(e.clientWidth)))); ro.observe(e); setW(Math.max(240, Math.floor(e.clientWidth))); return () => ro.disconnect(); }, []);
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
    // aiming line for the player to move
    if (mine && mode === "aim" && cue && !cue.in) {
      const hit = firstContact(b.balls, cue, aim), [sx, sy] = toScreen(cue.x, cue.y), [ex, ey] = toScreen(hit.x, hit.y);
      g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 1.6; g.setLineDash([7, 6]); g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      g.strokeStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.arc(ex, ey, R * k, 0, 7); g.stroke();
      if (hit.hit) { const o = b.balls[hit.hit], da = Math.atan2(o.y - hit.y, o.x - hit.x), [ox, oy] = toScreen(o.x, o.y), [tx, ty] = toScreen(o.x + Math.cos(da) * 90, o.y + Math.sin(da) * 90); g.strokeStyle = "rgba(255,225,120,.9)"; g.beginPath(); g.moveTo(ox, oy); g.lineTo(tx, ty); g.stroke(); }
      // the cue stick, drawn behind the ball
      const back = 26 + power * 90, [cx0, cy0] = toScreen(cue.x - Math.cos(aim) * (R + 6), cue.y - Math.sin(aim) * (R + 6)), [cx1, cy1] = toScreen(cue.x - Math.cos(aim) * (R + back + 180), cue.y - Math.sin(aim) * (R + back + 180));
      g.strokeStyle = "#e6c88e"; g.lineWidth = 5 * k; g.lineCap = "round"; g.beginPath(); g.moveTo(cx0, cy0); g.lineTo(cx1, cy1); g.stroke(); g.lineCap = "butt";
    }
    for (let n = 15; n >= 0; n--) { const p = pos[n]; if (!p || p.in) continue; const [sx, sy] = toScreen(p.x, p.y); drawBall(g, n, sx, sy, R * k, fade ? fade[n] : 1); }
    if (mine && mode === "place") { const [sx, sy] = toScreen(cue.x, cue.y); g.strokeStyle = "#ffe27a"; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, R * k + 4, 0, 7); g.stroke(); }
  }, [W, H, k, b, cue, aim, power, mode, mine, play, toScreen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const loop = (now) => { frame(now); raf.current = requestAnimationFrame(loop); }; raf.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf.current); }, [frame]);

  const point = (e) => { const r = cv.current.getBoundingClientRect(); return toTable((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)); };
  const placeAt = (x, y) => {
    const maxX = b.breakShot ? HEAD : TABLE.w - R, cx = Math.min(maxX, Math.max(R, x)), cy = Math.min(TABLE.h - R, Math.max(R, y));
    if (b.balls.some((o, n) => n > 0 && !o.in && Math.hypot(o.x - cx, o.y - cy) < 2 * R + 0.5)) return;
    setCuePos({ x: cx, y: cy });
  };
  const down = (e) => { if (!mine) return; e.currentTarget.setPointerCapture?.(e.pointerId); const [x, y] = point(e); if (mode === "place") placeAt(x, y); else setAim(Math.atan2(y - cue.y, x - cue.x)); };
  const move = (e) => { if (!mine || !(e.buttons & 1 || e.pointerType === "touch")) return; const [x, y] = point(e); if (mode === "place") placeAt(x, y); else setAim(Math.atan2(y - cue.y, x - cue.x)); };
  const shoot = () => act({ type: "shot", angle: aim, power, spin, ...(b.ballInHand ? { cue: { x: cue.x, y: cue.y } } : {}) });
  const mineGroup = b.groups[m.seat], theirGroup = b.groups[1 - m.seat];
  const tray = (g) => (g ? [...Array(7)].map((_, i) => (g === "solid" ? i + 1 : i + 9)) : []).map((n) => <i key={n} className="gm-pl-mini" data-out={b.balls[n].in ? "1" : undefined} style={{ "--c": colorOf(n) }} data-stripe={n >= 9 ? "1" : undefined}>{n}</i>);
  return (
    <div className="gm-pl">
      <div className="gm-pl-groups" aria-label="Ball groups">
        <div><span>{seatName(m, 1 - m.seat)}</span><div className="gm-pl-tray">{theirGroup ? tray(theirGroup) : <small>open table</small>}</div></div>
        <div><span>You</span><div className="gm-pl-tray">{mineGroup ? tray(mineGroup) : <small>open table</small>}</div></div>
      </div>
      <div className="gm-pl-wrap" ref={wrap}>
        <canvas ref={cv} className="gm-pl-cv" style={{ width: W, height: H, touchAction: "none" }} onPointerDown={down} onPointerMove={move} aria-label="Pool table" role="img" />
      </div>
      <p className="gm-note" role="status">{play ? "…" : b.msg}</p>
      {mine && (
        <div className="gm-pl-ctl">
          {b.ballInHand && <div className="gm-pl-modes"><button type="button" className="gm-chip" data-on={mode === "place" ? "1" : undefined} onClick={() => setMode("place")}>Place cue ball</button><button type="button" className="gm-chip" data-on={mode === "aim" ? "1" : undefined} onClick={() => setMode("aim")}>Aim</button></div>}
          <label className="gm-pl-row"><span>Power</span><input type="range" min="0" max="1" step="0.01" value={power} onChange={(e) => setPower(Number(e.target.value))} aria-label="Shot power" /><b className="num">{Math.round(power * 100)}%</b></label>
          <label className="gm-pl-row"><span>Spin</span><input type="range" min="-1" max="1" step="0.05" value={spin} onChange={(e) => setSpin(Number(e.target.value))} aria-label="Spin: draw to follow" /><b>{spin < -0.15 ? "Draw" : spin > 0.15 ? "Follow" : "None"}</b></label>
          <button type="button" className="gm-btn gm-btn-go" onClick={shoot}>Shoot</button>
          <p className="gm-note">{mode === "place" ? "Tap the table to place the cue ball" + (b.breakShot ? " behind the line." : ".") : "Drag on the table to aim. The dotted line shows where the cue ball first touches."}</p>
        </div>
      )}
      {!mine && m.status === "ACTIVE" && !m.yourTurn && !play && <p className="gm-note">{seatName(m, b.turn)} is lining up a shot…</p>}
    </div>
  );
}
