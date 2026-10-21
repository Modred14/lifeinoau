// components/games/MatchScreen.js: one live match. It asks the server for the match every second or so (the server is the only keeper of the game), draws the board for the game,
// sends moves, and shows the result, the money and the rematch flow. Leaving this screen does NOT forfeit: the clock is the only thing that ends a match nobody plays.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { notifyError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { gamesGet, gamesPost, clockText, koboNaira, nairaOf, outcomeText } from "@/lib/games/gamesClient";
import StakePicker, { PrizeLine } from "./StakePicker";
import LudoBoard from "./LudoBoard";
import ChessBoard from "./ChessBoard";
import PoolTable from "./PoolTable";
import HoopsBoard from "./HoopsBoard";
import CheckersBoard from "./CheckersBoard";
import Connect4Board from "./Connect4Board";
import TicTacToeBoard from "./TicTacToeBoard";
import WhotBoard from "./WhotBoard";

const BOARDS = { LUDO: LudoBoard, CHESS: ChessBoard, POOL: PoolTable, HOOPS: HoopsBoard, CHECKERS: CheckersBoard, CONNECT4: Connect4Board, TICTACTOE: TicTacToeBoard, WHOT: WhotBoard };
const RESULT_DELAY = { POOL: 2600, HOOPS: 2400, LUDO: 900, CHESS: 700, CHECKERS: 700, CONNECT4: 900, TICTACTOE: 700, WHOT: 1200 };

export default function MatchScreen({ id, onExit, onOpen, balanceKobo }) {
  const [m, setM] = useState(null), [busy, setBusy] = useState(false), [gone, setGone] = useState(null), [tick, setTick] = useState(0), [confirm, setConfirm] = useState(false), [showResult, setShowResult] = useState(false);
  const cur = useRef(null), since = useRef(1e9), skew = useRef(0), alive = useRef(true), timer = useRef(0), sending = useRef(false);

  const apply = useCallback((match) => {
    if (!match || !alive.current) return;
    if (cur.current && match.version < cur.current.version) return; // an older answer arriving late
    skew.current = match.now - Date.now(); cur.current = match; setM(match);
    const v = match.board?.last?.v; if (typeof v === "number") since.current = since.current === 1e9 ? v : Math.max(since.current, v); // (a first read asks for no recording: the shot on the table is old)
  }, []);
  const poll = useCallback(async () => {
    clearTimeout(timer.current);
    const r = await gamesGet(`match=${id}&since=${since.current}`);
    if (!alive.current) return;
    if (r.ok && r.match) apply(r.match); else if (r.status === 404) { setGone("That match is no longer available."); return; }
    const mm = cur.current, hidden = typeof document !== "undefined" && document.hidden;
    const wait = hidden ? 6000 : !mm ? 1500 : mm.status === "ACTIVE" ? (mm.yourTurn ? 1600 : 900) : mm.rematch?.live ? 1200 : 4000;
    timer.current = setTimeout(poll, wait);
  }, [id, apply]);
  useEffect(() => { alive.current = true; poll(); return () => { alive.current = false; clearTimeout(timer.current); }; }, [poll]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 500); return () => clearInterval(t); }, []);

  const send = useCallback(async (action) => {
    if (sending.current) return; sending.current = true; setBusy(true);
    const r = await gamesPost("move", { matchId: id, action, since: since.current === 1e9 ? 0 : since.current });
    sending.current = false; setBusy(false);
    if (r.error || r.failed || !r.match) { notifyError(r, "That move was not accepted."); poll(); return; }
    apply(r.match);
  }, [id, apply, poll]);
  const post = useCallback(async (op, body, okText) => {
    const r = await gamesPost(op, { matchId: id, ...body });
    if (r.error || r.failed) { notifyError(r); poll(); return r; }
    if (r.match) apply(r.match); else poll();
    if (okText) toast.info(okText);
    return r;
  }, [id, apply, poll]);

  // the match ended: give a last shot or throw a beat to play before the result card covers the board
  const over = m && m.status !== "ACTIVE" && m.status !== "INVITED";
  useEffect(() => {
    if (!over) { setShowResult(false); return; }
    const t = setTimeout(() => setShowResult(true), cur.current?.version > 0 ? RESULT_DELAY[m.game] ?? 800 : 0);
    return () => clearTimeout(t);
  }, [over, m?.game]);
  useEffect(() => { if (m?.rematch?.nextId) onOpen?.(m.rematch.nextId); }, [m?.rematch?.nextId, onOpen]);

  if (gone) return <div className="gm-pad"><p className="gm-note">{gone}</p><button type="button" className="gm-btn" onClick={onExit}>Back to games</button></div>;
  if (!m) return <div className="gm-pad gm-center"><i className="gm-spin" aria-hidden="true" /><p className="gm-note">Opening the match…</p></div>;
  const Board = BOARDS[m.game], left = m.deadline ? m.deadline - (Date.now() + skew.current) : null, warn = left != null && left < 10_000;
  void tick;
  return (
    <div className="gm-match">
      <header className="gm-mhead">
        <button type="button" className="gm-back" onClick={onExit} aria-label="Back to games"><Icon name="back" size={22} weight="bold" /></button>
        <div className="gm-mtitle"><b>{m.gameName}</b><small>{m.stakeNaira ? `Prize ${koboNaira(m.poolKobo)}` : "Friendly game"}</small></div>
        {m.status === "ACTIVE" && left != null && <span className="gm-clock num" data-warn={warn ? "1" : undefined} aria-label="Time left for this turn">{clockText(left)}</span>}
      </header>
      <PlayerBar m={m} who="opponent" />
      <div className="gm-stage"><Board m={m} b={m.board} act={send} busy={busy} /></div>
      <PlayerBar m={m} who="you" />
      {m.status === "ACTIVE" && (
        <div className="gm-controls">
          {m.drawOffer === "theirs" ? (
            <div className="gm-offer" role="alert"><span>{m.opponent.name} offers a draw{m.stakeNaira ? ": both wagers go back" : ""}.</span>
              <button type="button" className="gm-btn gm-btn-sm gm-btn-go" onClick={() => post("draw", { op: "accept" })}>Accept</button><button type="button" className="gm-btn gm-btn-sm" onClick={() => post("draw", { op: "decline" })}>Decline</button></div>
          ) : (
            <button type="button" className="gm-btn gm-btn-sm" disabled={m.drawOffer === "mine"} onClick={() => post("draw", { op: "offer" }, "Draw offered. Any move you make takes it back.")}>{m.drawOffer === "mine" ? "Draw offered…" : "Offer a draw"}</button>
          )}
          <button type="button" className="gm-btn gm-btn-sm gm-btn-bad" onClick={() => { if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3500); } else { setConfirm(false); post("resign", {}); } }}>{confirm ? (m.stakeNaira ? `Tap again: lose ${nairaOf(m.stakeNaira)}` : "Tap again to resign") : "Resign"}</button>
        </div>
      )}
      {over && showResult && <ResultCard m={m} post={post} onExit={onExit} onOpen={onOpen} balanceKobo={balanceKobo} skew={skew.current} />}
    </div>
  );
}

function PlayerBar({ m, who }) {
  const you = who === "you", name = you ? m.you.name : m.opponent.name, seat = you ? m.seat : 1 - m.seat, turn = m.status === "ACTIVE" && m.turn === seat;
  return (
    <div className="gm-pbar" data-turn={turn ? "1" : undefined} data-you={you ? "1" : undefined}>
      <span className="gm-av" data-s={seat} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <b>{name}{you ? " (you)" : ""}</b>
      {m.status === "ACTIVE" && <small>{turn ? (you ? "Your turn" : "Thinking…") : ""}</small>}
      {m.stakeNaira > 0 && <em className="num">{nairaOf(m.stakeNaira)}</em>}
    </div>
  );
}

function ResultCard({ m, post, onExit, onOpen, balanceKobo, skew }) {
  const [head, tone] = outcomeText(m), [stake, setStake] = useState(m.stakeNaira), [busy, setBusy] = useState(false), rm = m.rematch;
  const [, force] = useState(0); useEffect(() => { const t = setInterval(() => force((x) => x + 1), 500); return () => clearInterval(t); }, []);
  const money = m.outcome === "WON" ? (m.stakeNaira ? `You won ${koboNaira(m.payoutKobo)} (you put in ${nairaOf(m.stakeNaira)}).` : "A friendly win.")
    : m.outcome === "LOST" ? (m.stakeNaira ? `You lost your ${nairaOf(m.stakeNaira)} wager.` : "Better luck next time.") : m.stakeNaira ? `Your ${nairaOf(m.stakeNaira)} wager was returned.` : "Nothing was at stake.";
  const run = async (fn) => { setBusy(true); await fn(); setBusy(false); };
  const left = rm?.live ? Math.max(0, rm.expiresAt - (Date.now() + skew)) : 0;
  return (
    <div className="gm-result" data-tone={tone} role="dialog" aria-label="Match result">
      <div className="gm-result-card">
        <h3>{head}</h3>
        <p className="gm-reason">{m.reason}</p>
        <p className="gm-money" data-tone={tone}>{money}</p>
        {(
          <div className="gm-rematch">
            {!rm && (<>
              <p className="gm-strong">Play again?</p>
              <StakePicker value={stake} onChange={setStake} balanceKobo={balanceKobo} disabled={busy} />
              <button type="button" className="gm-btn gm-btn-go" disabled={busy} onClick={() => run(() => post("rematch", { stakeNaira: stake }))}>Ask for a rematch</button>
            </>)}
            {rm?.live && rm.byMe && (<><p className="gm-note">Waiting for {m.opponent.name} to answer… {Math.ceil(left / 1000)}s</p><button type="button" className="gm-btn gm-btn-sm" disabled={busy} onClick={() => run(() => post("rematchReply", { accept: false }))}>Cancel request</button></>)}
            {rm?.live && !rm.byMe && (<>
              <p className="gm-strong">{m.opponent.name} wants a rematch{rm.stakeNaira ? ` for ${nairaOf(rm.stakeNaira)}` : " (for fun)"}.</p>
              <PrizeLine stake={rm.stakeNaira} />
              <div className="gm-row"><button type="button" className="gm-btn gm-btn-go" disabled={busy} onClick={() => run(async () => { const r = await post("rematchReply", { accept: true }); if (r?.started && r.id) onOpen?.(r.id); })}>Accept{rm.stakeNaira ? ` & wager ${nairaOf(rm.stakeNaira)}` : ""}</button><button type="button" className="gm-btn" disabled={busy} onClick={() => run(() => post("rematchReply", { accept: false }))}>Decline</button></div>
            </>)}
            {rm && !rm.live && !rm.nextId && (<><p className="gm-note">{rm.declined != null ? (rm.declined === m.seat ? "You declined the rematch." : `${m.opponent.name} declined the rematch.`) : "The rematch request ran out of time."}</p>
              <button type="button" className="gm-btn" disabled={busy} onClick={() => run(() => post("rematch", { stakeNaira: stake }))}>Ask again</button></>)}
          </div>
        )}
        <button type="button" className="gm-link" onClick={onExit}>Back to games</button>
      </div>
    </div>
  );
}
