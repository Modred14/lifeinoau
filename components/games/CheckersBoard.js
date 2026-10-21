// components/games/CheckersBoard.js: Checkers. The server sends every legal move (a capture is compulsory); a tap only picks one of them, square by square for a multi-jump.
"use client";
import { useEffect, useMemo, useState } from "react";

const starts = (paths) => new Set(paths.map((p) => p.path[0]));

export default function CheckersBoard({ m, b, act, busy }) {
  const [sel, setSel] = useState([]); // the squares picked so far: [from, firstLanding, ...]
  const mine = m.yourTurn && !busy && m.status === "ACTIVE", flip = m.seat === 1; // the board is turned so your own pieces start at the bottom
  useEffect(() => { setSel([]); }, [b.plies]);
  const legal = b.legal ?? [], from = useMemo(() => starts(legal), [legal]);
  const nextSquares = useMemo(() => {
    if (!sel.length) return new Set();
    return new Set(legal.filter((p) => sel.every((s, i) => p.path[i] === s) && p.path.length > sel.length).map((p) => p.path[sel.length]));
  }, [legal, sel]);
  const tap = (s) => {
    if (!mine) return;
    if (!sel.length) { if (from.has(s)) setSel([s]); return; }
    if (nextSquares.has(s)) {
      const next = [...sel, s], full = legal.find((p) => p.path.length === next.length && p.path.every((q, i) => q === next[i]));
      if (full) { setSel([]); act({ type: "move", path: full.path }); } else setSel(next);
    } else if (from.has(s)) setSel([s]); else setSel([]);
  };
  const order = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i)), last = new Set(b.last?.path ?? []);
  return (
    <div className="gm-ck">
      <div className="gm-ck-board" role="grid" aria-label="Checkers board">
        {order.map((s) => {
          const r = Math.floor(s / 8), c = s % 8, dark = (r + c) % 2 === 1, p = b.board[s];
          return (
            <button key={s} type="button" className="gm-ck-sq" data-dark={dark ? "1" : undefined} data-sel={sel.includes(s) ? "1" : undefined} data-next={nextSquares.has(s) ? "1" : undefined}
              data-movable={mine && from.has(s) && !sel.length ? "1" : undefined} data-last={last.has(s) ? "1" : undefined} disabled={!dark || !mine} onClick={() => tap(s)} aria-label={`Square ${r + 1}-${c + 1}`}>
              {p ? <i className="gm-ck-pc" data-s={p <= 2 ? 0 : 1} data-king={p === 2 || p === 4 ? "1" : undefined} /> : null}
            </button>
          );
        })}
      </div>
      <p className="gm-note">{m.status !== "ACTIVE" ? "" : m.yourTurn ? (legal.some((p) => p.caps.length) ? "You must jump. Tap your piece, then where it lands." : "Your turn: tap a piece, then a square.") : "Waiting for your rival…"}</p>
    </div>
  );
}
