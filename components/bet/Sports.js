// components/bet/Sports.js: the fake football listing. Built from the clock alone, so it opens instantly; scores come from /api/bet/live.
"use client";
import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { useStore } from "@/lib/gameStore";
import { liveStore, useBuilder, builder, useNow, hhmm, countdown, odd } from "@/lib/bet/betClient";
import { LEAGUES, listRounds, fixturesOf, phaseAt, minuteAt, isOpen, CYCLE_MS, MATCH_MS } from "@/lib/bet/fixtures.js";
import { allOdds, MARKETS, MARKET_ORDER } from "@/lib/bet/markets.js";

function OddBtn({ fx, mk, pk, label, odds, closed }) {
  const b = useBuilder(), on = b.legs.some((l) => l.fx === fx.id && l.mk === mk && l.pk === pk);
  return (
    <button type="button" className={`od${on ? " on" : ""}`} disabled={closed} aria-pressed={on} aria-label={`${label} at ${odd(odds)}`} onClick={() => builder.toggle(fx, mk, pk)}>
      {closed ? <Icon name="lockS" size={14} weight="fill" /> : (<><span className="od-l">{label}</span><b className="num">{odd(odds)}</b></>)}
    </button>
  );
}

function Match({ fx, now, lv, onMore }) {
  const ph = phaseAt(fx.ko, now), closed = !isOpen(fx, now), o = useMemo(() => allOdds(fx), [fx]), m = minuteAt(fx.ko, now);
  const more = Object.keys(MARKETS).length - 1;
  return (
    <article className="mc">
      <div className="mc-top">
        <span className="mc-lg">{fx.leagueName}</span>
        {ph === "live" && <span className="mc-live"><i />{m}&apos;</span>}
        {ph === "ft" && <span className="mc-ft">Full time</span>}
        {ph === "pre" && <span className="mc-time">{hhmm(fx.ko)}</span>}
      </div>
      <div className="mc-teams">
        <div className="mc-row"><span>{fx.home}</span>{ph !== "pre" && <b className="num">{lv ? lv.h : "–"}</b>}</div>
        <div className="mc-row"><span>{fx.away}</span>{ph !== "pre" && <b className="num">{lv ? lv.a : "–"}</b>}</div>
      </div>
      <div className="mc-odds">
        <OddBtn fx={fx} mk="1x2" pk="h" label="1" odds={o["1x2"].h} closed={closed} />
        <OddBtn fx={fx} mk="1x2" pk="d" label="X" odds={o["1x2"].d} closed={closed} />
        <OddBtn fx={fx} mk="1x2" pk="a" label="2" odds={o["1x2"].a} closed={closed} />
        <button type="button" className="od more" disabled={closed} onClick={() => onMore(fx)} aria-label="More markets"><b>+{more}</b></button>
      </div>
    </article>
  );
}

function MarketsSheet({ fx, onClose }) {
  const o = useMemo(() => allOdds(fx), [fx]);
  return (
    <div className="bt-sheet-scrim" onClick={onClose}>
      <div className="bt-sheet" role="dialog" aria-label="All markets" onClick={(e) => e.stopPropagation()}>
        <i className="bt-sheet-grab" />
        <div className="bt-sheet-head"><div><b>{fx.home} v {fx.away}</b><small>{fx.leagueName}</small></div><button type="button" className="bt-sheet-x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button></div>
        <div className="bt-sheet-body">
          {MARKET_ORDER.map((mk) => (
            <div className="mk" key={mk}>
              <h4>{MARKETS[mk].name}</h4>
              <div className="mk-picks" data-n={Object.keys(MARKETS[mk].picks).length}>
                {Object.entries(MARKETS[mk].picks).map(([pk, [label]]) => <OddBtn key={pk} fx={fx} mk={mk} pk={pk} label={label} odds={o[mk][pk]} />)}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="bt-primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default function Sports({ active }) {
  const now = useNow(1000), live = useStore(liveStore), [league, setLeague] = useState("all"), [more, setMore] = useState(null);
  const lmap = useMemo(() => Object.fromEntries((live?.live ?? []).map((x) => [x.id, x])), [live]);
  const rounds = listRounds(now).filter((r) => phaseAt(fixturesOf(r)[0].ko, now) !== "ft"); // finished matches live in My Bets; the listing is for what you can still back
  return (
    <>
    <div className="bt-scroll sp" aria-hidden={!active}>
      <div className="bt-chips" role="group" aria-label="League">
        {[{ id: "all", name: "All matches" }, ...LEAGUES].map((l) => <button key={l.id} type="button" className={league === l.id ? "on" : ""} onClick={() => setLeague(l.id)}>{l.name}</button>)}
      </div>
      {rounds.map((r, i) => {
        const fxs = fixturesOf(r).filter((f) => league === "all" || f.league === league), ko = fxs[0].ko, ph = phaseAt(ko, now);
        return (
          <section key={r} className="rd">
            <h3 className="rd-h">
              {ph === "live" ? <span className="rd-live"><i />Live now</span> : ph === "ft" ? <span className="rd-ft">Results</span> : <span>Kick-off {hhmm(ko)}</span>}
              <small>{ph === "pre" ? `in ${countdown(ko - now)}` : ph === "live" ? `full time in ${countdown(ko + MATCH_MS - now)}` : `next round in ${countdown(ko + CYCLE_MS - now)}`}</small>
            </h3>
            {fxs.map((fx) => <Match key={fx.id} fx={fx} now={now} lv={lmap[fx.id]} onMore={setMore} />)}
          </section>
        );
      })}
      <p className="fine">18+ · Fake leagues and teams, in-game cash only. Odds include the bookmaker&apos;s margin, so over time the house wins.</p>
    </div>
    {more && <MarketsSheet fx={more} onClose={() => setMore(null)} />}
    </>
  );
}