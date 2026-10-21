// components/games/WhotPractice.js: Whot against the computer, for fun. Nothing is at stake and nothing is saved: it runs the same rules engine (lib/games/whot.js) in the browser,
// and the computer only ever plays moves that engine accepts. Wagers and ranked results exist only in live matches, which the server decides.
"use client";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { create, act, view, chooseMove } from "@/lib/games/whot";
import { RuleError } from "@/lib/games/errors";
import { WhotTable } from "./WhotCards";

const nameOf = (s) => (s === 0 ? "You" : "Computer");
const fmt = (t) => t.replace(/Seat 0 (is|misses|picks)/g, (_, w) => ({ is: "You are", misses: "You miss", picks: "You pick" }[w])).replace(/Seat 0/g, "You").replace(/Seat 1/g, "Computer");

export default function WhotPractice({ onExit }) {
  const [st, setSt] = useState(() => create(Math.random)), [over, setOver] = useState(null), [msg, setMsg] = useState("");
  const apply = (seat, action) => { const r = act(st, seat, action); setSt(r.state); if (r.over) setOver(r.over); };
  // the computer's turn: a short pause so the player can follow what it does
  useEffect(() => {
    if (over || st.turn !== 1) return;
    const t = setTimeout(() => { try { apply(1, chooseMove(st, 1)); } catch (e) { console.error("whot computer", e); } }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, over]);
  const mine = (action) => { try { setMsg(""); apply(0, action); } catch (e) { if (e instanceof RuleError) setMsg(e.message); else throw e; } };
  const again = () => { setSt(create(Math.random)); setOver(null); setMsg(""); };
  const v = view(st, 0), tone = !over ? null : over.winner === 0 ? "win" : over.winner === 1 ? "lose" : "draw";
  return (
    <div className="gm-match">
      <header className="gm-mhead">
        <button type="button" className="gm-back" onClick={onExit} aria-label="Back to games"><Icon name="back" size={22} weight="bold" /></button>
        <div className="gm-mtitle"><b>Whot</b><small>Practice against the computer · nothing at stake</small></div>
      </header>
      <div className="gm-stage">
        <WhotTable v={v} nameOf={nameOf} fmt={fmt} canAct={!over} onPlay={(card, shape) => mine(shape ? { type: "play", card, shape } : { type: "play", card })} onDraw={() => mine({ type: "draw" })} />
        {msg && <p className="gm-note" role="alert">{msg}</p>}
      </div>
      {over && (
        <div className="gm-result" data-tone={tone} role="dialog" aria-label="Game result">
          <div className="gm-result-card">
            <h3>{tone === "win" ? "You won!" : tone === "lose" ? "The computer won" : "Draw"}</h3>
            <p className="gm-reason">{over.winner == null ? over.reason : `${nameOf(over.winner)}: ${over.reason}`}</p>
            <button type="button" className="gm-btn gm-btn-go" onClick={again}>Play again</button>
            <button type="button" className="gm-link" onClick={onExit}>Back to games</button>
          </div>
        </div>
      )}
    </div>
  );
}
