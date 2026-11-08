// components/games/TicTacToeBoard.js: Tic-Tac-Toe (best of three rounds). Draws what the server says; a tap only sends "mark this square".
"use client";
import { useEffect, useRef, useState } from "react";
import { seatName } from "@/lib/games/gamesClient";
import { WIN_ROUNDS, MAX_ROUNDS } from "@/lib/games/tictactoe";

const MARK = ["X", "O"];
const BEAT_MS = 1400; // how long the finished round stays on show before the empty board of the next one can be played

export default function TicTacToeBoard({ m, b, act, busy }) {
  // When a round ends the server deals an empty board at once (and sends the finished one as `prev`). The finished board is shown for a beat, then the new round is playable.
  // The beat is tied to the round NUMBER changing on this screen, so it always ends, and a screen opened in the middle of a round never shows a stale board.
  const round = useRef(b.round), [beat, setBeat] = useState(false);
  useEffect(() => {
    if (b.round === round.current) return;
    round.current = b.round; setBeat(true);
    const t = setTimeout(() => setBeat(false), BEAT_MS); return () => clearTimeout(t);
  }, [b.round]);
  const showPrev = beat && !!b.prev && b.board.every((c) => c === 0);
  const mine = m.yourTurn && !busy && m.status === "ACTIVE" && !showPrev, win = new Set(showPrev ? b.prev.line ?? [] : b.line ?? []);
  const cells = showPrev ? b.prev.board : b.board;
  return (
    <div className="gm-ttt">
      <div className="gm-ttt-score" aria-label="Rounds won">
        {[0, 1].map((s) => (
          <div key={s} className="gm-ttt-side" data-me={s === m.seat ? "1" : undefined} data-turn={m.status === "ACTIVE" && b.turn === s ? "1" : undefined}>
            <b className="gm-ttt-mark" data-s={s}>{MARK[s]}</b><span>{seatName(m, s)}</span><em className="num">{b.wins[s]}</em>
          </div>
        ))}
      </div>
      <p className="gm-note">Round {Math.min(b.round, MAX_ROUNDS)} of up to {MAX_ROUNDS}. First to win {WIN_ROUNDS} rounds takes the match.</p>
      <div className="gm-ttt-grid" role="grid" aria-label="Tic-Tac-Toe board">
        {cells.map((c, i) => (
          <button key={i} type="button" role="gridcell" className="gm-ttt-cell" data-s={c ? c - 1 : undefined} data-win={win.has(i) ? "1" : undefined} data-last={!showPrev && b.last === i ? "1" : undefined}
            disabled={!mine || c !== 0} onClick={() => act({ type: "mark", cell: i })} aria-label={`Square ${i + 1}${c ? ", " + MARK[c - 1] : ""}`}>
            {c ? MARK[c - 1] : ""}
          </button>
        ))}
      </div>
      {b.rounds.length > 0 && (
        <ol className="gm-ttt-rounds" aria-label="Round results">
          {b.rounds.map((r) => <li key={r.round}>Round {r.round}: {r.winner == null ? "drawn" : `${seatName(m, r.winner)} won`}</li>)}
        </ol>
      )}
    </div>
  );
}
