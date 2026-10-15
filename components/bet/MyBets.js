// components/bet/MyBets.js: your slips. Open ones update on their own while the matches play; settled ones keep the result.
"use client";
import { useState } from "react";
import { Icon } from "../Icon";
import { useStore } from "@/lib/gameStore";
import { slipsStore, useNow, moneyK, odd, pickLabel, hhmm, countdown } from "@/lib/bet/betClient";
import { marketName } from "@/lib/bet/markets.js";
import { minuteAt, MATCH_MS } from "@/lib/bet/fixtures.js";

function Leg({ l, now }) {
  const live = l.st === "live" || (l.st === "pending" && now >= l.ko), m = minuteAt(l.ko, now), done = l.st === "won" || l.st === "lost";
  const wrap = live && now >= l.ko + MATCH_MS; // full time reached here, the server has not confirmed it yet
  return (
    <li className={`lg ${l.st}${l.st === "live" && l.winning ? " up" : ""}`}>
      <span className="lg-i" aria-label={l.st}>
        {l.st === "won" ? <Icon name="win" size={20} weight="fill" /> : l.st === "lost" ? <Icon name="lose" size={20} weight="fill" /> : live ? <i className="lg-pulse" /> : <Icon name="clock" size={18} />}
      </span>
      <div className="lg-b">
        <b>{pickLabel(l)}</b>
        <span>{l.home} v {l.away}</span>
        <small>{marketName(l.mk)} · {odd(l.odds)}</small>
      </div>
      <div className="lg-r">
        {done && <b className="num">{l.h} - {l.a}</b>}
        {l.st === "live" && <><b className="num">{l.h} - {l.a}</b><small>{wrap ? "FT" : `${m}'`}</small></>}
        {l.st === "pending" && (live ? <small>{wrap ? "FT" : `${m}'`}</small> : <small>{hhmm(l.ko)}<br />in {countdown(l.ko - now)}</small>)}
      </div>
    </li>
  );
}

function Slip({ s, now }) {
  const won = s.verdict === "WON", lost = s.verdict === "LOST", settled = s.status !== "OPEN" || won || lost;
  const wonN = s.legs.filter((l) => l.st === "won").length;
  return (
    <article className={`sl ${won ? "won" : lost ? "lost" : ""}`}>
      <header className="sl-h">
        <b>{s.legs.length === 1 ? "Single" : `Multiple · ${s.legs.length}`}</b>
        <span className={`pill ${won ? "won" : lost ? "lost" : "open"}`}>{won ? "Won" : lost ? "Lost" : "Open"}</span>
      </header>
      <ul className="lg-list">{s.legs.map((l) => <Leg key={l.fx} l={l} now={now} />)}</ul>
      {!settled && s.legs.length > 1 && <div className="sl-prog"><i style={{ width: `${(wonN / s.legs.length) * 100}%` }} /><small>{wonN} of {s.legs.length} won</small></div>}
      <footer className="sl-f">
        <div><small>Stake</small><b className="num">{moneyK(s.stakeKobo)}</b></div>
        <div><small>Odds</small><b className="num">{s.odds}</b></div>
        <div className="end"><small>{won ? "Won" : lost ? "Returned" : "Potential win"}</small><b className="num">{won ? moneyK(s.payoutKobo !== "0" ? s.payoutKobo : s.potentialKobo) : lost ? "₦0" : moneyK(s.potentialKobo)}</b></div>
      </footer>
    </article>
  );
}

export default function MyBets({ active, goSports }) {
  const now = useNow(1000), d = useStore(slipsStore), [seg, setSeg] = useState("open");
  const all = d?.slips ?? [], isOpen = (s) => s.status === "OPEN" && s.verdict === "OPEN";
  const open = all.filter(isOpen), settled = all.filter((s) => !isOpen(s)), list = seg === "open" ? open : settled;
  return (
    <div className="bt-scroll" aria-hidden={!active}>
      <div className="seg" role="tablist" aria-label="Slips">
        <button type="button" role="tab" aria-selected={seg === "open"} className={seg === "open" ? "on" : ""} onClick={() => setSeg("open")}>Open{open.length ? ` (${open.length})` : ""}</button>
        <button type="button" role="tab" aria-selected={seg === "settled"} className={seg === "settled" ? "on" : ""} onClick={() => setSeg("settled")}>Settled</button>
      </div>
      {!d ? <p className="empty">Loading your bets…</p> : list.length === 0 ? (
        <div className="empty-card">
          <Icon name="receipt" size={34} />
          <b>{seg === "open" ? "No open bets" : "Nothing settled yet"}</b>
          <p>{seg === "open" ? "Pick a few matches, place a slip, and wait for the final whistles." : "Slips land here once every match on them has finished."}</p>
          {seg === "open" && <button type="button" className="bt-primary slim" onClick={goSports}>Browse matches</button>}
        </div>
      ) : list.map((s) => <Slip key={s.id} s={s} now={now} />)}
      <p className="fine">18+ · Play with in-game cash only.</p>
    </div>
  );
}