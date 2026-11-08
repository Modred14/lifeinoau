// components/games/LudoBoard.js: Ludo with two dice. The dice are rolled on the server; the board is drawn from the same geometry the rules use (lib/games/ludo.js).
// Each die is its own move: tap a die to choose it (when both can be played), then tap a glowing token. A tap on a token that only one die can move uses that die.
"use client";
import { useEffect, useRef, useState } from "react";
import { TRACK, HOME_COLUMN, SAFE, COLORS, YARD, HOME, START, cell } from "@/lib/games/ludo";
import { seatName } from "@/lib/games/gamesClient";

const PIPS = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] };
const NEUTRAL = ["#3f9c6a", "#4a86d6"]; // the two corners nobody plays in a two-player game
const COLOR_NAME = ["red", "yellow"];
const ROLL_MS = 600, WALK_MS = 130;

function Die({ value, rolling, used, picked, onPick, label }) {
  const body = (
    <svg className="gm-die" data-rolling={rolling ? "1" : undefined} data-used={used ? "1" : undefined} data-picked={picked ? "1" : undefined} viewBox="0 0 3 3" aria-hidden="true" focusable="false">
      <rect x=".05" y=".05" width="2.9" height="2.9" rx=".5" />
      {(PIPS[value] ?? []).map(([x, y], i) => <circle key={i} cx={x + 0.5} cy={y + 0.5} r=".24" />)}
    </svg>
  );
  return onPick
    ? <button type="button" className="gm-die-btn" onClick={onPick} aria-pressed={picked} aria-label={`${label}: ${value}. ${picked ? "Chosen" : "Choose this die"}`}>{body}</button>
    : <span className="gm-die-btn" role="img" aria-label={value ? `${label}: ${value}${used ? ", already played" : ""}` : label}>{body}</span>;
}

/** The progress each token is DRAWN at: a token that moved n squares is walked there one square at a time (a capture or a first read just jumps), so a move reads as a move. */
function useWalk(tokens) {
  const shown = useRef(tokens.map((r) => [...r])), [, force] = useState(0);
  useEffect(() => {
    let t = 0, dead = false;
    const tick = () => {
      if (dead) return;
      let more = false;
      tokens.forEach((row, s) => row.forEach((goal, k) => {
        const p = shown.current[s][k]; if (p === goal) return;
        shown.current[s][k] = goal < p || goal - p > 12 ? goal : p + 1; // back to the yard: at once; far behind (a reconnect): catch up at once
        if (shown.current[s][k] !== goal) more = true;
      }));
      force((x) => x + 1);
      if (more) t = setTimeout(tick, WALK_MS);
    };
    tick();
    return () => { dead = true; clearTimeout(t); };
  }, [tokens]);
  return shown.current;
}

export default function LudoBoard({ m, b, act, busy }) {
  const mine = m.yourTurn && !busy && m.status === "ACTIVE", options = b.options ?? [], can = new Set(b.can ?? []);
  // the dice: a roll tumbles for a moment (random faces), then settles on the real values the server rolled
  const [rolling, setRolling] = useState(false), [faces, setFaces] = useState([1, 1]), prev = useRef(b.moves);
  useEffect(() => {
    if (b.moves === prev.current) return;
    prev.current = b.moves; setRolling(true);
    const spin = setInterval(() => setFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]), 80), end = setTimeout(() => setRolling(false), ROLL_MS);
    return () => { clearInterval(spin); clearTimeout(end); };
  }, [b.moves]);
  const real = b.dice ?? b.last?.dice ?? [null, null], shown = rolling ? faces : real;
  // which die you are about to play: the one you tapped if it can still move, otherwise the first that can
  const [want, setWant] = useState(null);
  const pickDie = options.find((o) => o.die === want)?.die ?? options[0]?.die ?? null, pickTokens = new Set(options.find((o) => o.die === pickDie)?.tokens ?? []);
  useEffect(() => { if (b.phase === "roll") setWant(null); }, [b.phase, b.moves]);
  const choosing = !rolling && mine && b.phase === "move" && options.length > 1, pickIdx = [0, 1].find((i) => !b.used?.[i] && real[i] === pickDie) ?? -1; // both dice can be played: the player chooses which first
  const play = (token) => { if (!mine) return; const o = options.find((x) => x.die === pickDie && x.tokens.includes(token)) ?? options.find((x) => x.tokens.includes(token)); if (o) act({ type: "move", token, die: o.die }); };

  const walk = useWalk(b.tokens);
  // tokens grouped by square so two on one square are drawn side by side
  const at = new Map();
  for (let s = 0; s < 2; s++) walk[s].forEach((p, t) => { const [c, r] = cell(s, t, p), k = p === 0 ? `y${s}${t}` : `${c},${r}`; (at.get(k) ?? at.set(k, []).get(k)).push({ s, t, p, c, r }); });
  const lastTok = (k) => b.last?.seat === k.s && b.last?.moved === k.t;
  const toks = [...at.values()].flatMap((g) => g.map((x, i) => ({ ...x, dx: g.length > 1 ? (i - (g.length - 1) / 2) * 0.34 : 0, dy: g.length > 1 ? (i % 2 ? 0.12 : -0.12) : 0 }))).sort((a, c) => Number(lastTok(a)) - Number(lastTok(c))); // the token that just moved is drawn on top
  const trail = b.last?.moved != null && b.last.to > 0 ? [cell(b.last.seat, b.last.moved, b.last.from), cell(b.last.seat, b.last.moved, b.last.to)] : null;
  const you = COLOR_NAME[m.seat];
  return (
    <div className="gm-ludo">
      <svg className="gm-ludo-board" viewBox="0 0 15 15" role="img" aria-label={`Ludo board. You play ${you}.`}>
        <rect width="15" height="15" rx=".5" fill="#f4efe2" />
        {[[0, 0, 0], [9, 9, 1], [9, 0, 2], [0, 9, 3]].map(([x, y, k]) => (
          <g key={k}><rect x={x} y={y} width="6" height="6" fill={k < 2 ? COLORS[k] : NEUTRAL[k - 2]} opacity={k < 2 ? 1 : 0.85} />
            <rect x={x + 1} y={y + 1} width="4" height="4" rx=".6" fill="#f8f4ea" stroke={k < 2 && m.status === "ACTIVE" && b.turn === k ? "#1a1d25" : "none"} strokeWidth=".14" /></g>
        ))}
        {TRACK.map(([c, r], i) => <rect key={i} x={c} y={r} width="1" height="1" fill={i === START[0] ? COLORS[0] : i === START[1] ? COLORS[1] : "#fffdf6"} stroke="#b9b19c" strokeWidth=".05" />)}
        {HOME_COLUMN.map((col, s) => col.map(([c, r], i) => <rect key={s + "-" + i} x={c} y={r} width="1" height="1" fill={COLORS[s]} opacity=".92" stroke="#b9b19c" strokeWidth=".05" />))}
        {trail && trail.map(([c, r], i) => <rect key={"t" + i} x={c + 0.08} y={r + 0.08} width=".84" height=".84" rx=".12" fill="none" stroke="#1a1d25" strokeOpacity=".55" strokeWidth=".09" strokeDasharray={i ? "0" : ".18 .14"} />)}
        {[...SAFE].filter((i) => i !== START[0] && i !== START[1]).map((i) => <text key={i} x={TRACK[i][0] + 0.5} y={TRACK[i][1] + 0.74} textAnchor="middle" fontSize=".7" fill="#b09a54">★</text>)}
        <polygon points="6,6 9,6 7.5,7.5" fill={NEUTRAL[0]} /><polygon points="9,6 9,9 7.5,7.5" fill={NEUTRAL[1]} /><polygon points="6,9 9,9 7.5,7.5" fill={COLORS[1]} /><polygon points="6,6 6,9 7.5,7.5" fill={COLORS[0]} />
        {[0, 1].map((s) => YARD[s].map(([c, r], i) => <circle key={s + "y" + i} cx={c + 0.5} cy={r + 0.5} r=".42" fill="#fffdf6" stroke={COLORS[s]} strokeWidth=".08" />))}
        {toks.map((k) => {
          const x = k.c + 0.5 + k.dx, y = k.r + 0.5 + k.dy, mineTok = k.s === m.seat && can.has(k.t) && mine;
          return (
            <g key={`${k.s}-${k.t}`} className="gm-ludo-tok" data-can={mineTok ? "1" : undefined} data-pick={mineTok && pickTokens.has(k.t) ? "1" : undefined} data-last={lastTok(k) ? "1" : undefined} style={{ transform: `translate(${x}px, ${y}px)` }}
              onClick={mineTok ? () => play(k.t) : undefined} role={mineTok ? "button" : undefined} tabIndex={mineTok ? 0 : undefined} aria-label={mineTok ? `Move token ${k.t + 1}` : undefined}
              onKeyDown={mineTok ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(k.t); } } : undefined}>
              {mineTok && <circle r=".6" className="gm-ludo-halo" />}
              <circle r=".36" cy=".05" fill="rgba(0,0,0,.28)" /><circle r=".36" fill={COLORS[k.s]} stroke="#fff" strokeWidth=".09" /><circle r=".16" fill="rgba(255,255,255,.55)" />
              {k.p === HOME && <text y=".12" textAnchor="middle" fontSize=".34" fill="#fff" fontWeight="700">✓</text>}
              {mineTok && <circle r=".72" fill="transparent" />}
            </g>
          );
        })}
      </svg>
      <div className="gm-ludo-panel">
        <div className="gm-dice" aria-label="Dice" data-rolling={rolling ? "1" : undefined}>
          {[0, 1].map((i) => (
            <Die key={i} value={shown[i]} rolling={rolling} label={`Die ${i + 1}`} used={!rolling && b.dice != null && !!b.used?.[i]} picked={choosing && i === pickIdx}
              onPick={choosing && !b.used?.[i] && options.some((o) => o.die === shown[i]) ? () => setWant(shown[i]) : undefined} />
          ))}
        </div>
        <div className="gm-ludo-act">
          {m.status === "ACTIVE" && mine && b.phase === "roll" && <button type="button" className="gm-btn gm-btn-go" disabled={rolling} onClick={() => act({ type: "roll" })}>Roll the dice</button>}
          {m.status === "ACTIVE" && mine && b.phase === "move" && !rolling && <p className="gm-note gm-strong">{options.length > 1 ? `Tap a die, then a glowing token. Playing the ${pickDie}.` : `Tap a glowing token to move it ${pickDie}.`}</p>}
          {m.status === "ACTIVE" && !m.yourTurn && <p className="gm-note">{seatName(m, b.turn)} is playing…</p>}
          {m.status === "ACTIVE" && !rolling && b.last?.pass && <p className="gm-note">{seatName(m, b.last.seat)} rolled {b.last.dice[0]} and {b.last.dice[1]}: {b.last.pass === "no move" ? "no move possible" : "three doubles in a row, turn lost"}.</p>}
        </div>
      </div>
    </div>
  );
}
