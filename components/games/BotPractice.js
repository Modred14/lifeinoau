// components/games/BotPractice.js: practice against the computer for any game except Whot (which has its own, WhotPractice). Nothing is at stake and nothing is saved.
// The game itself lives in lib/games/practice.js (the real rules engine plus the same AI that fills in for a missing opponent); this screen only draws it with the SAME board a live match
// uses, by handing that board the small `m` / `b` / `act` it expects, and gives the computer a person's pause before each move.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { RuleError } from "@/lib/games/errors";
import { ENGINES } from "@/lib/games/index";
import { botId } from "@/lib/games/ai";
import { newPractice, playerMove, botMove, botDelay, isBotTurn, isYourTurn, turnSeat, resign, resultText, YOU } from "@/lib/games/practice";
import { BOARDS, RESULT_DELAY } from "./boards";
import { PlayerBar } from "./MatchScreen";
import PracticeResult from "./PracticeResult";

export default function BotPractice({ game, onExit }) {
  const eng = ENGINES[game], Board = BOARDS[game];
  const [p, setP] = useState(() => newPractice(game)), [game_, setGame_] = useState(0), [msg, setMsg] = useState(""), [showResult, setShowResult] = useState(false), [confirm, setConfirm] = useState(false);

  // the computer's turn: a person's pause, then its move (the effect restarts on every move, so a stale timer never plays)
  useEffect(() => {
    if (!isBotTurn(p)) return;
    const t = setTimeout(() => { try { setP(botMove(p)); } catch (e) { console.error("practice computer", e); } }, botDelay(p));
    return () => clearTimeout(t);
  }, [p]);
  // a last shot or throw to watch before the result card covers the board
  useEffect(() => {
    if (!p.over) { setShowResult(false); return; }
    const t = setTimeout(() => setShowResult(true), RESULT_DELAY[game] ?? 800);
    return () => clearTimeout(t);
  }, [p.over, game]);

  const latest = useRef(p); latest.current = p;
  const act = useCallback((action) => {
    try { setMsg(""); setP(playerMove(latest.current, action)); } catch (e) { if (e instanceof RuleError) setMsg(e.message); else throw e; }
  }, []);
  const again = () => { setP(newPractice(game, Math.random, botId(p.bot.key))); setGame_((n) => n + 1); setMsg(""); setConfirm(false); };

  const m = useMemo(() => ({
    id: "practice", game, gameName: eng.info.name, status: p.over ? "FINISHED" : "ACTIVE", seat: YOU, version: p.version, turn: turnSeat(p), yourTurn: isYourTurn(p), deadline: null, now: Date.now(),
    you: { name: "You" }, opponent: { name: p.bot.name, level: p.bot.level, ai: true }, stakeNaira: 0, poolKobo: "0",
  }), [p, game, eng]);
  const b = useMemo(() => eng.view(p.state, YOU, { since: 0 }), [p.state, eng]); // since 0: Pool always carries the recording of the last shot; the table plays each one once
  const [head, tone, reason] = p.over ? resultText(p) : [];
  return (
    <div className="gm-match">
      <header className="gm-mhead">
        <button type="button" className="gm-back" onClick={onExit} aria-label="Back to games"><Icon name="back" size={22} weight="bold" /></button>
        <div className="gm-mtitle"><b>{eng.info.name}</b><small>Practice against {p.bot.name} · nothing at stake</small></div>
      </header>
      <PlayerBar m={m} who="opponent" />
      <div className="gm-stage"><Board key={game_} m={m} b={b} act={act} busy={false} />{msg && <p className="gm-note" role="alert">{msg}</p>}</div>
      <PlayerBar m={m} who="you" />
      {!p.over && (
        <div className="gm-controls">
          <button type="button" className="gm-btn gm-btn-sm gm-btn-bad" onClick={() => { if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3500); } else { setConfirm(false); setP(resign(p)); } }}>{confirm ? "Tap again to resign" : "Resign"}</button>
        </div>
      )}
      {p.over && showResult && <PracticeResult head={head} tone={tone} reason={reason} onAgain={again} onExit={onExit} />}
    </div>
  );
}
