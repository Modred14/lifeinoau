// components/games/TicTacToeBoard.js: Tic-Tac-Toe (best of three rounds). Draws what the server says; a tap only sends "mark this square".
"use client";
import { seatName } from "@/lib/games/gamesClient";

const MARK = ["X", "O"];

export default function TicTacToeBoard({ m, b, act, busy }) {
  const mine = m.yourTurn && !busy && m.status === "ACTIVE", win = new Set(b.line ?? b.prev?.line ?? []);
  const showPrev = b.board.every((c) => c === 0) && b.prev; // a new round just began: keep showing the last round's board for a beat
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
      <p className="gm-note">Round {Math.min(b.round, 5)} of up to 5. First to win two rounds takes the match.</p>
      <div className="gm-ttt-grid" role="grid" aria-label="Tic-Tac-Toe board">
        {cells.map((c, i) => (
          <button key={i} type="button" role="gridcell" className="gm-ttt-cell" data-s={c ? c - 1 : undefined} data-win={win.has(i) ? "1" : undefined} data-last={b.last === i ? "1" : undefined}
            disabled={!mine || c !== 0 || showPrev} onClick={() => act({ type: "mark", cell: i })} aria-label={`Square ${i + 1}${c ? ", " + MARK[c - 1] : ""}`}>
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
