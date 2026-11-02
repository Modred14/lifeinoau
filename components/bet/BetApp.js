// components/bet/BetApp.js: the Bet app, lives inside the phone (see components/Phone.js)
// It opens on a list of games (the lobby), inside the handset. Picking a game (Sports, Aviator, Roulette) or My Bets opens it FULL SCREEN:
// while a game is open this marks <body data-bet-full>, and the phone shell (phone.css) turns the handset into the whole window and puts the
// LifeinOAU bars away. Back goes to the list; the back arrow on the list goes to the phone's home screen. Leaving the app (or closing the phone)
// removes the mark again, so the normal interface always comes back.
// Every game stays mounted, so a plane in the air keeps flying while you look at your slips.
"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Icon } from "../Icon";
import { naira } from "@/lib/client";
import { useStore } from "@/lib/gameStore";
import { liveStore, slipsStore, useWallet, useBuilder, builder } from "@/lib/bet/betClient";
import Lobby from "./Lobby";
import Sports from "./Sports";
import Aviator from "./Aviator";
import Roulette from "./Roulette";
import MyBets from "./MyBets";
import SlipSheet from "./SlipSheet";
import "./bet.css";

const GAMES = [
  { id: "sports", name: "Sports", icon: "ball", blurb: "Football matches and your betslip" },
  { id: "aviator", name: "Aviator", icon: "plane", blurb: "Cash out before the plane flies away" },
  { id: "roulette", name: "Roulette", icon: "roulette", blurb: "European wheel with one zero" },
];
const BETS = { id: "bets", name: "My bets", icon: "receipt", blurb: "Your open and settled slips" };
const TITLES = Object.fromEntries([...GAMES, BETS].map((g) => [g.id, g.name]));
const LOBBY = "lobby";

export default function BetApp({ onHome }) {
  const [view, setView] = useState(LOBBY);
  const bal = useWallet(), slips = useStore(slipsStore), b = useBuilder();
  const open = slips?.slips.filter((s) => s.verdict === "OPEN" && s.status === "OPEN").length ?? 0;
  const full = view !== LOBBY;

  // keep scores and slips fresh: quicker when you are looking at them or have a slip running
  useEffect(() => {
    slipsStore.refresh(); liveStore.refresh();
    const watching = view === "sports" || view === "bets";
    const t1 = setInterval(() => !document.hidden && liveStore.refresh(), watching ? 4000 : 20000);
    const t2 = setInterval(() => !document.hidden && slipsStore.refresh(), open || view === "bets" ? 5000 : 25000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [view, open]);

  // A game is open: tell the shell. useLayoutEffect, so the handset has already grown to the whole window when the game first paints (no flash of the
  // small phone), and the cleanup runs on every way out (back, the phone closing, another app opening), so no mark and no hidden bar is ever left behind.
  useLayoutEffect(() => {
    if (!full) return;
    const body = document.body;
    body.dataset.betFull = "1";
    return () => { delete body.dataset.betFull; };
  }, [full]);

  const toLobby = useCallback(() => { builder.open(false); setView(LOBBY); }, []);
  // Escape (and the phone's own Escape, which steps aside while a game is open): close the betslip first, then go back to the list
  useEffect(() => {
    if (!full) return;
    const k = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault(); e.stopPropagation();
      if (builder.get().open) builder.open(false); else toLobby();
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [full, toLobby]);

  return (
    <div className="bt" data-view={view} data-full={full ? "1" : undefined}>
      <header className="bt-head">
        {full ? (
          <button type="button" className="bt-back" onClick={toLobby} aria-label="Back to games"><Icon name="back" size={22} weight="bold" /></button>
        ) : (
          <button type="button" className="bt-back" onClick={onHome} aria-label="Back to home screen"><Icon name="back" size={22} weight="bold" /></button>
        )}
        <span className="bt-logo" aria-hidden="true"><Icon name={full ? (view === "bets" ? BETS.icon : GAMES.find((g) => g.id === view)?.icon) : "ticket"} size={16} weight="fill" /></span>
        <h2>{full ? TITLES[view] : "OAU Bet"}</h2>
        <span className="bt-wallet" aria-label="Your cash"><Icon name="coins" size={15} weight="fill" /><b className="num">{naira(bal)}</b></span>
      </header>

      <div className="bt-main">
        <section className="bt-panel" hidden={full} aria-label="Games"><Lobby games={GAMES} bets={BETS} open={open} onPick={setView} /></section>
        <section className="bt-panel" hidden={view !== "sports"}><Sports active={view === "sports"} /></section>
        <section className="bt-panel" hidden={view !== "aviator"}><Aviator active={view === "aviator"} /></section>
        <section className="bt-panel" hidden={view !== "roulette"}><Roulette active={view === "roulette"} /></section>
        <section className="bt-panel" hidden={view !== "bets"}><MyBets active={view === "bets"} goSports={() => setView("sports")} /></section>

        {view === "sports" && b.legs.length > 0 && !b.open && (
          <button type="button" className="bt-slipbar" onClick={() => builder.open(true)}>
            <span className="bt-slipbar-n">{b.legs.length}</span>
            <span className="bt-slipbar-t"><b>Betslip</b><small>{b.legs.length === 1 ? "Single" : `Multiple · ${b.legs.length} matches`}</small></span>
            <Icon name="up" size={18} weight="bold" />
          </button>
        )}
        <SlipSheet goBets={() => setView("bets")} goSports={() => setView("sports")} />
      </div>
    </div>
  );
}
