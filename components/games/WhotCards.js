// components/games/WhotCards.js: Whot cards and the Whot table. Pure drawing: it shows what the engine says (lib/games/whot.js view) and reports taps.
// Used by the live match (WhotBoard) and by the practice game against the computer (WhotPractice), so both look and behave the same.
"use client";
import { useState } from "react";
import { SHAPES, SHAPE_LABEL, POWER, cardName } from "@/lib/games/whot";
import "./whot.css";

const SHAPE_PATH = {
  circle: <circle cx="20" cy="20" r="15" />,
  triangle: <polygon points="20,4 37,35 3,35" />,
  cross: <path d="M15 4h10v11h11v10H25v11H15V25H4V15h11z" />,
  square: <rect x="6" y="6" width="28" height="28" rx="2" />,
  star: <polygon points="20,2 25.5,14.5 39,15.5 28.8,24.5 32,38 20,30.8 8,38 11.2,24.5 1,15.5 14.5,14.5" />,
};
const SHORT = { 1: "Hold on", 2: "Pick 2", 5: "Pick 3", 8: "Suspend", 14: "Market" };
const ORDER = { circle: 0, triangle: 1, cross: 2, square: 3, star: 4, whot: 5 };

export function Glyph({ shape }) {
  return <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">{SHAPE_PATH[shape]}</svg>;
}

/** One card. `back` draws the face-down side. Pass onClick to make it a button. */
export function WhotCard({ card, back, playable, dim, onClick, disabled, fresh }) {
  const label = back ? "Face-down card" : `${cardName(card)}${card.s !== "whot" && POWER[card.n] ? `, ${POWER[card.n]}` : ""}`;
  const props = { className: "wh-card", "data-shape": back ? undefined : card.s, "data-back": back ? "1" : undefined, "data-playable": playable ? "1" : undefined, "data-dim": dim ? "1" : undefined, "data-new": fresh ? "1" : undefined, "aria-label": label };
  const face = back ? <span className="wh-logo">WHOT</span> : card.s === "whot"
    ? (<><b className="wh-pip">20</b><span className="wh-word">WHOT</span><b className="wh-pip wh-pip-b">20</b></>)
    : (<><b className="wh-pip">{card.n}</b><Glyph shape={card.s} /><b className="wh-pip wh-pip-b">{card.n}</b>{SHORT[card.n] && <i className="wh-power">{SHORT[card.n]}</i>}</>);
  return onClick ? <button type="button" {...props} data-clickable="1" onClick={onClick} disabled={disabled}>{face}</button> : <div {...props}>{face}</div>;
}

/**
 * The whole table. `v` is the engine's view for the player at the bottom. `canAct` is false while the screen is not this player's to use (a finished match, a request in flight).
 * nameOf(seat) and fmt(text) turn seats into names. onPlay(cardId, shape?) and onDraw() send the move.
 */
export function WhotTable({ v, nameOf, fmt, canAct, onPlay, onDraw }) {
  const [pick, setPick] = useState(null);
  const me = v.seat, foe = 1 - me, myTurn = !!canAct && v.turn === me && !v.done, ok = new Set(myTurn ? v.playable : []);
  const hand = [...v.hand].sort((a, b) => ORDER[a.s] - ORDER[b.s] || a.n - b.n);
  const tap = (c) => { if (!myTurn || !ok.has(c.id)) return; if (c.s === "whot") setPick(c); else onPlay(c.id); };
  const status = v.done ? "Game over." : myTurn
    ? (v.pending ? `Pick ${v.pending.count}! Answer with a ${v.pending.n}, or take them from the market.` : v.playable.length ? "Your turn: play a raised card." : "Nothing to play: tap the market.")
    : `${nameOf(foe)} is playing…`;
  const lines = v.log.slice(-3);
  return (
    <div className="wh">
      <div className="wh-row">
        <div className="wh-label"><b>{nameOf(foe)}</b><span>{v.counts[foe]} card{v.counts[foe] === 1 ? "" : "s"}</span>{v.counts[foe] === 1 && !v.done && <span className="wh-last" role="status">Last card!</span>}</div>
        {v.done && v.opponentHand ? <div className="wh-open">{[...v.opponentHand].sort((a, b) => ORDER[a.s] - ORDER[b.s] || a.n - b.n).map((c) => <WhotCard key={c.id} card={c} />)}</div>
          : <div className="wh-fan" aria-hidden="true">{Array.from({ length: Math.min(v.counts[foe], 12) }, (_, i) => <WhotCard key={i} back />)}</div>}
      </div>

      <div className="wh-felt">
        {v.pending && <div className="wh-pend" role="status">Pick {v.pending.count} is on: {v.turn === me ? "you" : nameOf(v.turn)} must answer with a {v.pending.n} or pick</div>}
        <div className="wh-piles">
          <div className="wh-pile">
            <button type="button" className="wh-market" data-ready={myTurn && v.canDraw ? "1" : undefined} disabled={!myTurn || !v.canDraw} onClick={onDraw} aria-label={v.pending ? `Take ${v.pending.count} cards from the market` : "Go to market and pick a card"}>
              <WhotCard back /><span className="wh-count num">{v.market}</span>
            </button>
            <span>{myTurn && v.canDraw ? (v.pending ? `Pick ${v.pending.count}` : "Go to market") : "Market"}</span>
          </div>
          <div className="wh-pile"><WhotCard key={v.top.id} card={v.top} fresh={v.moves > 0} /><span>Pile · {v.discard}</span></div>
        </div>
        {v.want && <div className="wh-want" data-shape={v.want} role="status"><Glyph shape={v.want} />Asking for {SHAPE_LABEL[v.want]}</div>}
      </div>

      <p className="wh-status" data-you={myTurn ? "1" : undefined} role="status" aria-live="polite">{status}</p>
      {lines.length > 0 && <ul className="wh-log" aria-label="Recent plays">{lines.map((t, i) => <li key={v.moves + "-" + i}>{fmt(t)}</li>)}</ul>}

      <div className="wh-row">
        <div className="wh-label"><b>Your cards</b><span>{v.hand.length}</span>{v.hand.length === 1 && !v.done && <span className="wh-last">Last card!</span>}</div>
        <div className="wh-hand" role="group" aria-label="Your cards">
          {hand.map((c) => <WhotCard key={c.id} card={c} playable={ok.has(c.id)} dim={myTurn && !ok.has(c.id)} onClick={() => tap(c)} disabled={!ok.has(c.id)} />)}
        </div>
      </div>

      {pick && (
        <div className="wh-pick" role="dialog" aria-label="Choose a shape">
          <div className="wh-pick-card">
            <b>Whot! Which shape do you want?</b>
            <div className="wh-shapes">
              {SHAPES.map((s) => <button key={s} type="button" className="wh-shape" data-shape={s} onClick={() => { const id = pick.id; setPick(null); onPlay(id, s); }}><Glyph shape={s} /><span>{SHAPE_LABEL[s]}</span></button>)}
            </div>
            <button type="button" className="gm-link" onClick={() => setPick(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
