// components/games/Connect4Board.js: Connect Four. Tapping a column sends "drop here"; the server decides where the disc lands and whether anyone has four.
"use client";
import { COLS, ROWS } from "@/lib/games/connect4";

export default function Connect4Board({ m, b, act, busy }) {
  const mine = m.yourTurn && !busy && m.status === "ACTIVE", line = new Set(b.line ?? []);
  const full = (c) => b.board[c] !== 0; // the top cell of a column is taken: the column is full
  return (
    <div className="gm-c4">
      <div className="gm-c4-board" style={{ "--cols": COLS, "--rows": ROWS }} role="grid" aria-label="Connect Four board">
        {Array.from({ length: COLS }, (_, c) => (
          <button key={c} type="button" className="gm-c4-col" disabled={!mine || full(c)} onClick={() => act({ type: "drop", col: c })} aria-label={`Drop a disc in column ${c + 1}`}>
            {Array.from({ length: ROWS }, (_, r) => {
              const i = r * COLS + c, v = b.board[i];
              return <span key={r} className="gm-c4-slot"><i className="gm-c4-disc" data-s={v ? v - 1 : undefined} data-last={b.last === i ? "1" : undefined} data-win={line.has(i) ? "1" : undefined} style={{ "--fall": r + 1 }} /></span>;
            })}
          </button>
        ))}
      </div>
      <p className="gm-note">{m.status !== "ACTIVE" ? "" : m.yourTurn ? "Your turn: tap a column." : "Waiting for your rival…"}</p>
    </div>
  );
}
