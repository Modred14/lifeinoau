// components/games/ChessBoard.js: Chess. The server sends the board and, for the player to move, every legal target of every piece; the screen only highlights them and sends "from, to".
"use client";
import { useEffect, useRef, useState } from "react";
import { seatName } from "@/lib/games/gamesClient";

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }; // the solid shapes for both colours; the colour comes from CSS
const VS = "︎"; // keeps phones from turning the pawn into an emoji
const FILES = "abcdefgh";
const nameOf = (i) => FILES[i & 7] + (8 - (i >> 3));
const isW = (p) => p !== "." && p === p.toUpperCase();
const PROMO = [["q", "Queen"], ["r", "Rook"], ["b", "Bishop"], ["n", "Knight"]];

export default function ChessBoard({ m, b, act, busy }) {
  const [sel, setSel] = useState(null), [promo, setPromo] = useState(null); // promo: { from, to } waiting for a piece choice
  const mine = m.yourTurn && !busy && m.status === "ACTIVE", white = b.white === m.seat, flip = !white; // your own side is at the bottom
  const moveNo = b.moves.length, el = useRef(null);
  useEffect(() => { setSel(null); setPromo(null); }, [moveNo]);
  const targets = new Set(sel ? b.legal?.[sel] ?? [] : []);
  const kingSq = b.check ? b.board.split("").findIndex((p, i) => p === (b.turn === b.white ? "K" : "k")) : -1;
  const tap = (name) => {
    if (!mine) return;
    if (sel && targets.has(name)) {
      const p = b.board[FILES.indexOf(sel[0]) + (8 - Number(sel[1])) * 8], last = name[1] === (isW(p) ? "8" : "1");
      if (p.toLowerCase() === "p" && last) { setPromo({ from: sel, to: name }); return; }
      setSel(null); act({ type: "move", from: sel, to: name }); return;
    }
    setSel(b.legal?.[name] ? (name === sel ? null : name) : null);
  };
  const order = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i));
  const capturedBy = (side) => b.taken[side].map((t, i) => <i key={i} className="gm-ch-cap" data-c={side === "w" ? "b" : "w"}>{GLYPH[t] + VS}</i>);
  const me = white ? "w" : "b", them = white ? "b" : "w";
  return (
    <div className="gm-ch" ref={el}>
      <div className="gm-ch-taken" aria-label={`${seatName(m, 1 - m.seat)} has taken`}>{capturedBy(them)}</div>
      <div className="gm-ch-board" role="grid" aria-label="Chess board">
        {order.map((i) => {
          const name = nameOf(i), p = b.board[i], dark = ((i >> 3) + (i & 7)) % 2 === 1, last = b.last && (b.last.from === name || b.last.to === name);
          const showFile = flip ? i >> 3 === 0 : i >> 3 === 7, showRank = flip ? (i & 7) === 7 : (i & 7) === 0;
          return (
            <button key={i} type="button" className="gm-ch-sq" data-dark={dark ? "1" : undefined} data-sel={sel === name ? "1" : undefined} data-target={targets.has(name) ? (p !== "." ? "cap" : "1") : undefined}
              data-last={last ? "1" : undefined} data-check={i === kingSq ? "1" : undefined} data-movable={mine && !sel && b.legal?.[name] ? "1" : undefined} onClick={() => tap(name)} disabled={!mine && !p}
              aria-label={`${name}${p !== "." ? " " + (isW(p) ? "white " : "black ") + p.toLowerCase() : ""}`}>
              {p !== "." && <b className="gm-ch-pc" data-c={isW(p) ? "w" : "b"}>{GLYPH[p.toLowerCase()] + VS}</b>}
              {showFile && <i className="gm-ch-file">{name[0]}</i>}{showRank && <i className="gm-ch-rank">{name[1]}</i>}
            </button>
          );
        })}
      </div>
      <div className="gm-ch-taken" aria-label="You have taken">{capturedBy(me)}</div>
      {promo && (
        <div className="gm-ch-promo" role="dialog" aria-label="Promote your pawn">
          <p>Promote to</p>
          <div>{PROMO.map(([k, label]) => <button key={k} type="button" onClick={() => { act({ type: "move", from: promo.from, to: promo.to, promo: k }); setPromo(null); setSel(null); }} aria-label={label}><b data-c={white ? "w" : "b"}>{GLYPH[k] + VS}</b><span>{label}</span></button>)}</div>
          <button type="button" className="gm-link" onClick={() => setPromo(null)}>Cancel</button>
        </div>
      )}
      <p className="gm-note">{m.status !== "ACTIVE" ? "" : b.check && m.yourTurn ? "Check! Protect your king." : m.yourTurn ? "Your turn." : "Waiting for your rival…"}</p>
      {b.moves.length > 0 && <p className="gm-ch-moves" aria-label="Moves">{b.moves.map((t, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${t}` : t)).slice(-8).join("  ")}</p>}
    </div>
  );
}
