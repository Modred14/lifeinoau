// components/games/HoopsBoard.js: Basketball. Pick a range, stop the moving meter on the green zone, and watch the ball fly. The meter is only a picture of timing:
// the server keeps its own clock for the meter and decides, with its own dice, whether the ball goes in.
"use client";
import { useEffect, useRef, useState } from "react";
import { meterAt, SPOTS } from "@/lib/games/hoops";
import { seatName } from "@/lib/games/gamesClient";

const SPOT_ORDER = ["LAYUP", "THREE", "HALF"];
const FROM = { LAYUP: { x: 50, y: 70 }, THREE: { x: 22, y: 78 }, HALF: { x: 50, y: 96 } }; // where the shooter stands (% of the court)

export default function HoopsBoard({ m, b, act, busy }) {
  const mine = m.yourTurn && !busy && m.status === "ACTIVE";
  const [now, setNow] = useState(0), seenAt = useRef(null), raf = useRef(0);
  const [flight, setFlight] = useState(null), shown = useRef(b.shots[0] + b.shots[1]);
  // the meter starts counting from the moment THIS screen learned it had started (the server accepts that within a small allowance)
  useEffect(() => { seenAt.current = b.phase === "meter" ? performance.now() : null; }, [b.phase, b.meterStart]);
  useEffect(() => {
    if (!(mine && b.phase === "meter")) return;
    const tick = () => { setNow(performance.now() - (seenAt.current ?? performance.now())); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf.current);
  }, [mine, b.phase, b.meterStart]);
  // a new shot (yours or your rival's): play the flight, then show the result
  useEffect(() => {
    const n = b.shots[0] + b.shots[1];
    if (n > shown.current && b.last) { shown.current = n; setFlight({ ...b.last, k: n }); const t = setTimeout(() => setFlight(null), 2200); return () => clearTimeout(t); }
    shown.current = n;
  }, [b.shots, b.last]);
  const meter = mine && b.phase === "meter" ? meterAt(now) : null, spot = b.spot ? SPOTS[b.spot] : null;
  const shooter = flight ? flight.seat : b.turn, st = flight ? FROM[flight.spot] : FROM[b.spot ?? "THREE"];
  return (
    <div className="gm-hp">
      <div className="gm-hp-score" aria-label="Score">
        {[0, 1].map((s) => (
          <div key={s} className="gm-hp-side" data-turn={b.turn === s && m.status === "ACTIVE" ? "1" : undefined} data-me={s === m.seat ? "1" : undefined}>
            <span>{seatName(m, s)}</span><b className="num">{b.score[s]}</b><small>{b.shots[s]}/{b.rounds} shots{b.streak[s] >= 2 ? " · on fire 🔥" : ""}</small>
          </div>
        ))}
      </div>
      <div className="gm-hp-court" aria-label="Basketball court">
        <svg viewBox="0 0 100 110" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Court with a hoop">
          <rect width="100" height="110" fill="#c98a4b" /><rect y="0" width="100" height="40" fill="#b87a3e" />
          <path d="M8 110 V50 A42 42 0 0 1 92 50 V110" fill="none" stroke="#fff6" strokeWidth=".8" /><rect x="35" y="0" width="30" height="42" fill="none" stroke="#fff6" strokeWidth=".8" /><circle cx="50" cy="42" r="10" fill="none" stroke="#fff6" strokeWidth=".8" />
          <rect x="38" y="6" width="24" height="14" rx="1" fill="#f4f1ea" stroke="#d8d2c4" strokeWidth=".6" /><rect x="45" y="12" width="10" height="6" fill="none" stroke="#e0612d" strokeWidth=".8" />
          <ellipse cx="50" cy="20" rx="6" ry="1.8" fill="none" stroke="#e0612d" strokeWidth="1.2" /><path d="M44.5 20.5 L46.5 28 M55.5 20.5 L53.5 28 M50 21 V28" stroke="#fff" strokeWidth=".35" opacity=".8" />
          <g className="gm-hp-player" style={{ transform: `translate(${st.x}px, ${st.y}px)` }}><circle r="4.4" fill={shooter === 0 ? "#d64545" : "#3f7fd6"} stroke="#fff" strokeWidth=".7" /><circle cy="-1" r="1.5" fill="#fff4" /></g>
          {flight && <circle key={flight.k} className="gm-hp-ball" data-made={flight.made ? "1" : "0"} r="2.2" cx="0" cy="0" style={{ "--x0": `${st.x}px`, "--y0": `${st.y - 5}px`, "--x1": flight.made ? "50px" : "61px", "--y1": flight.made ? "21px" : "17px" }} />}
        </svg>
        {flight && <div className="gm-hp-result" data-made={flight.made ? "1" : "0"} role="status"><b>{flight.made ? (flight.fire ? `On fire! +${flight.pts}` : `Swish! +${flight.pts}`) : "Missed"}</b><small>{seatName(m, flight.seat)} · {flight.grade}</small></div>}
      </div>
      {m.status === "ACTIVE" && mine && b.phase === "pick" && (
        <div className="gm-hp-pick">
          <p className="gm-note gm-strong">Your shot: pick a range.</p>
          <div className="gm-hp-spots">{SPOT_ORDER.map((k) => <button key={k} type="button" className="gm-btn" onClick={() => act({ type: "pick", spot: k })}><b>{SPOTS[k].label}</b><small>{SPOTS[k].pts} points · {k === "LAYUP" ? "easiest" : k === "THREE" ? "balanced" : "hardest"}</small></button>)}</div>
        </div>
      )}
      {m.status === "ACTIVE" && mine && b.phase === "meter" && spot && (
        <div className="gm-hp-meter">
          <div className="gm-hp-bar" aria-hidden="true"><i className="gm-hp-zone" style={{ left: `${(b.zoneAt - b.zone / 2) * 100}%`, width: `${b.zone * 100}%` }} /><i className="gm-hp-cursor" style={{ left: `${(meter ?? 0) * 100}%` }} /></div>
          <button type="button" className="gm-btn gm-btn-go gm-hp-shoot" onClick={() => act({ type: "release", elapsed: Math.round(performance.now() - (seenAt.current ?? performance.now())) })}>Shoot! ({spot.label})</button>
          <p className="gm-note">Tap when the marker is in the green zone.</p>
        </div>
      )}
      {m.status === "ACTIVE" && !m.yourTurn && <p className="gm-note">{seatName(m, b.turn)} is {b.phase === "meter" ? "lining up the shot" : "picking a range"}…</p>}
      {b.sudden > 0 && m.status === "ACTIVE" && <p className="gm-note gm-strong">Sudden death: one shot each until someone leads.</p>}
    </div>
  );
}
