// components/games/WhotBoard.js: Whot in a live match. The server keeps the deck and both hands; this only draws the player's own view and sends "play this card" or "go to market".
"use client";
import { seatName, nameSeats } from "@/lib/games/gamesClient";
import { WhotTable } from "./WhotCards";

export default function WhotBoard({ m, b, act, busy }) {
  return (
    <WhotTable v={b} nameOf={(s) => seatName(m, s)} fmt={(t) => nameSeats(m, t)} canAct={m.status === "ACTIVE" && m.yourTurn && !busy}
      onPlay={(card, shape) => act(shape ? { type: "play", card, shape } : { type: "play", card })} onDraw={() => act({ type: "draw" })} />
  );
}
