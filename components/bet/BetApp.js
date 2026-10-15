// components/bet/BetApp.js: the Bet app, lives inside the phone (see components/Phone.js)
// Four tabs: Sports (fake football listing and a bet slip), Aviator, Roulette and My Bets.
// Every tab stays mounted, so a plane in the air keeps flying while you look at your slips.
"use client";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { naira } from "@/lib/client";
import { useStore } from "@/lib/gameStore";
import { liveStore, slipsStore, useWallet, useBuilder, builder } from "@/lib/bet/betClient";
import Sports from "./Sports";
import Aviator from "./Aviator";
import Roulette from "./Roulette";
import MyBets from "./MyBets";
import SlipSheet from "./SlipSheet";
import "./bet.css";

const TABS = [
  { id: "sports", name: "Sports", icon: "ball" },
  { id: "aviator", name: "Aviator", icon: "plane" },
  { id: "roulette", name: "Roulette", icon: "roulette" },
  { id: "bets", name: "My bets", icon: "receipt" },
];

export default function BetApp({ onHome }) {
  const [tab, setTab] = useState("sports");
  const bal = useWallet(), slips = useStore(slipsStore), b = useBuilder();
  const open = slips?.slips.filter((s) => s.verdict === "OPEN" && s.status === "OPEN").length ?? 0;

  // keep scores and slips fresh: quicker when you are looking at them or have a slip running
  useEffect(() => {
    slipsStore.refresh(); liveStore.refresh();
    const watching = tab === "sports" || tab === "bets";
    const t1 = setInterval(() => !document.hidden && liveStore.refresh(), watching ? 4000 : 20000);
    const t2 = setInterval(() => !document.hidden && slipsStore.refresh(), open || tab === "bets" ? 5000 : 25000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [tab, open]);

  return (
    <div className="bt">
      <header className="bt-head">
        <button type="button" className="bt-back" onClick={onHome} aria-label="Back to home screen"><Icon name="back" size={22} weight="bold" /></button>
        <span className="bt-logo" aria-hidden="true"><Icon name="ticket" size={16} weight="fill" /></span>
        <h2>OAU Bet</h2>
        <span className="bt-wallet" aria-label="Your cash"><Icon name="coins" size={15} weight="fill" /><b className="num">{naira(bal)}</b></span>
      </header>

      <div className="bt-main">
        <section className="bt-panel" hidden={tab !== "sports"}><Sports active={tab === "sports"} /></section>
        <section className="bt-panel" hidden={tab !== "aviator"}><Aviator active={tab === "aviator"} /></section>
        <section className="bt-panel" hidden={tab !== "roulette"}><Roulette active={tab === "roulette"} /></section>
        <section className="bt-panel" hidden={tab !== "bets"}><MyBets active={tab === "bets"} goSports={() => setTab("sports")} /></section>

        {tab === "sports" && b.legs.length > 0 && !b.open && (
          <button type="button" className="bt-slipbar" onClick={() => builder.open(true)}>
            <span className="bt-slipbar-n">{b.legs.length}</span>
            <span className="bt-slipbar-t"><b>Betslip</b><small>{b.legs.length === 1 ? "Single" : `Multiple · ${b.legs.length} matches`}</small></span>
            <Icon name="up" size={18} weight="bold" />
          </button>
        )}
        <SlipSheet goBets={() => setTab("bets")} goSports={() => setTab("sports")} />
      </div>

      <nav className="bt-tabs" role="tablist" aria-label="Bet sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            <span className="bt-tab-i"><Icon name={t.icon} size={22} weight={tab === t.id ? "fill" : "regular"} />{t.id === "bets" && open > 0 ? <i className="bt-dot">{open}</i> : null}</span>
            <span>{t.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}