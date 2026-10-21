// components/games/LudoBoard.js: Ludo. The dice are rolled on the server; the board is drawn from the same geometry the rules use (lib/games/ludo.js).
"use client";
import { useEffect, useRef, useState } from "react";
import { TRACK, HOME_COLUMN, SAFE, COLORS, YARD, HOME, cell } from "@/lib/games/ludo";
import { nameSeats, seatName } from "@/lib/games/gamesClient";

const PIPS = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] };
const NEUTRAL = ["#3f9c6a", "#4a86d6"]; // the two corners nobody plays in a two-player game

function Die({ value, rolling }) {
  return (
    <svg className="gm-die" data-rolling={rolling ? "1" : undefined} viewBox="0 0 3 3" role="img" aria-label={value ? `Dice shows ${value}` : "Dice"}>
      <rect x=".02" y=".02" width="2.96" height="2.96" rx=".5" />
      {(PIPS[value] ?? []).map(([x, y], i) => <circle key={i} cx={x + 0.5} cy={y + 0.5} r=".24" />)}
    </svg>
  );
}

export default function LudoBoard({ m, b, act, busy }) {
  const mine = m.yourTurn && !busy && m.status === "ACTIVE", can = new Set(b.can ?? []);
  const [rolling, setRolling] = useState(false), prev = useRef(b.moves);
  useEffect(() => { if (b.moves !== prev.current && b.last?.moved == null && b.last?.dice) { setRolling(true); const t = setTimeout(() => setRolling(false), 450); prev.current = b.moves; return () => clearTimeout(t); } prev.current = b.moves; }, [b.moves, b.last]);
  const shown = b.dice ?? b.last?.dice ?? null;
  // tokens grouped by square so two on one square are drawn side by side
  const at = new Map();
  for (let s = 0; s < 2; s++) b.tokens[s].forEach((p, t) => { const [c, r] = cell(s, t, p), k = p === 0 ? `y${s}${t}` : `${c},${r}`; (at.get(k) ?? at.set(k, []).get(k)).push({ s, t, p, c, r }); });
  const toks = [...at.values()].flatMap((g) => g.map((x, i) => ({ ...x, dx: g.length > 1 ? (i - (g.length - 1) / 2) * 0.34 : 0, dy: g.length > 1 ? (i % 2 ? 0.12 : -0.12) : 0 })));
  const ring = (s) => COLORS[s];
  return (
    <div className="gm-ludo">
      <svg className="gm-ludo-board" viewBox="0 0 15 15" role="img" aria-label="Ludo board">
        <rect width="15" height="15" rx=".5" fill="#f4efe2" />
        {[[0, 0, 0], [9, 9, 1], [9, 0, 2], [0, 9, 3]].map(([x, y, k]) => (
          <g key={k}><rect x={x} y={y} width="6" height="6" fill={k < 2 ? COLORS[k] : NEUTRAL[k - 2]} opacity={k < 2 ? 1 : 0.85} /><rect x={x + 1} y={y + 1} width="4" height="4" rx=".6" fill="#f8f4ea" /></g>
        ))}
        {TRACK.map(([c, r], i) => <rect key={i} x={c} y={r} width="1" height="1" fill={i === 0 ? COLORS[0] : i === 26 ? COLORS[1] : "#fffdf6"} stroke="#c9c1ad" strokeWidth=".04" />)}
        {HOME_COLUMN.map((col, s) => col.map(([c, r], i) => <rect key={s + "-" + i} x={c} y={r} width="1" height="1" fill={COLORS[s]} opacity=".9" stroke="#c9c1ad" strokeWidth=".04" />))}
        {[...SAFE].filter((i) => i !== 0 && i !== 26).map((i) => <text key={i} x={TRACK[i][0] + 0.5} y={TRACK[i][1] + 0.74} textAnchor="middle" fontSize=".7" fill="#b09a54">★</text>)}
        <polygon points="6,6 9,6 7.5,7.5" fill={NEUTRAL[0]} /><polygon points="9,6 9,9 7.5,7.5" fill={NEUTRAL[1]} /><polygon points="6,9 9,9 7.5,7.5" fill={COLORS[1]} /><polygon points="6,6 6,9 7.5,7.5" fill={COLORS[0]} />
        {[0, 1].map((s) => YARD[s].map(([c, r], i) => <circle key={s + "y" + i} cx={c + 0.5} cy={r + 0.5} r=".42" fill="#fffdf6" stroke={COLORS[s]} strokeWidth=".08" />))}
        {toks.map((k) => {
          const x = k.c + 0.5 + k.dx, y = k.r + 0.5 + k.dy, can_ = k.s === m.seat && can.has(k.t);
          return (
            <g key={`${k.s}-${k.t}`} className="gm-ludo-tok" data-can={can_ ? "1" : undefined} data-last={b.last?.seat === k.s && b.last?.moved === k.t ? "1" : undefined} style={{ transform: `translate(${x}px, ${y}px)` }}
              onClick={can_ && mine ? () => act({ type: "move", token: k.t }) : undefined} role={can_ ? "button" : undefined} tabIndex={can_ && mine ? 0 : undefined} aria-label={can_ ? `Move token ${k.t + 1}` : undefined}
              onKeyDown={can_ && mine ? (e) => { if (e.key === "Enter" || e.key === " ") act({ type: "move", token: k.t }); } : undefined}>
              {can_ && <circle r=".6" className="gm-ludo-halo" />}
              <circle r=".36" fill={ring(k.s)} stroke="#fff" strokeWidth=".09" /><circle r=".16" fill="rgba(255,255,255,.55)" />
              {k.p === HOME && <text y=".12" textAnchor="middle" fontSize=".34" fill="#fff" fontWeight="700">✓</text>}
            </g>
          );
        })}
      </svg>
      <div className="gm-ludo-panel">
        <Die value={shown} rolling={rolling} />
        <div className="gm-ludo-act">
          {m.status === "ACTIVE" && mine && b.phase === "roll" && <button type="button" className="gm-btn gm-btn-go" onClick={() => act({ type: "roll" })}>Roll the dice</button>}
          {m.status === "ACTIVE" && mine && b.phase === "move" && <p className="gm-note gm-strong">You rolled {b.dice}. Tap a glowing token.</p>}
          {m.status === "ACTIVE" && !m.yourTurn && <p className="gm-note">{seatName(m, b.turn)} is playing…</p>}
          {b.last?.pass && <p className="gm-note">{seatName(m, b.last.seat)} rolled {b.last.dice}: {b.last.pass === "no move" ? "no move possible" : "three sixes, turn lost"}.</p>}
        </div>
      </div>
      <ul className="gm-log" aria-label="Recent moves">{b.log.slice(-3).reverse().map((l, i) => <li key={i}>{nameSeats(m, l)}</li>)}</ul>
    </div>
  );
}
