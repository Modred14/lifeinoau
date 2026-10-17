// components/bet/SlipSheet.js: the bet slip. Placing is instant: the slip appears in My Bets and the cash leaves your wallet at once,
// and both are put back (and your picks return to the slip) if the server refuses.
"use client";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import { call } from "@/lib/client";
import { game, run, cash, canAfford, useGame } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { slipsStore, useBuilder, builder, useNow, money, moneyK, odd, pickLabel } from "@/lib/bet/betClient";
import { isOpen, parseId } from "@/lib/bet/fixtures.js";
import { marketName, payoutOf, totalOddsX, MIN_STAKE, MAX_STAKE } from "@/lib/bet/markets.js";

const QUICK = [500, 1000, 2000, 5000];

export default function SlipSheet({ goBets, goSports }) {
  const b = useBuilder(), router = useRouter(), g = useGame(), now = useNow(1000); // ticks, so a match that kicks off while the slip is open is flagged at once
  if (!b.open || !b.legs.length) return null;
  const closed = b.legs.filter((l) => !isOpen(parseId(l.fx), now)), stake = Number(b.stake) || 0;
  const total = totalOddsX(b.legs), win = stake >= MIN_STAKE ? payoutOf(BigInt(stake) * 100n, b.legs) : 0n;
  const bal = BigInt(g?.balanceKobo ?? 0), short = stake * 100 > Number(bal);
  const bad = stake < MIN_STAKE ? `Minimum stake is ${money(MIN_STAKE)}` : stake > MAX_STAKE ? `Maximum stake is ${money(MAX_STAKE)}` : closed.length ? "Remove matches that have started" : short ? "Not enough cash" : "";

  async function place() {
    if (bad) return toast.error(bad, { id: "betbad" });
    if (!canAfford(BigInt(stake) * 100n)) return toast.error("You do not have enough cash for that stake.");
    const legs = b.legs, n = legs.length, stakeKobo = BigInt(stake) * 100n, tmp = "tmp-" + crypto.randomUUID();
    const temp = (x) => ({ ...x, slips: [{ id: tmp, stakeKobo: stakeKobo.toString(), odds: total.toFixed(2), potentialKobo: win.toString(), status: "OPEN", verdict: "OPEN", payoutKobo: "0", createdAt: Date.now(), settledAt: null, legs: legs.map((l) => ({ ...l, st: "pending" })) }, ...x.slips] });
    builder.clear(); builder.open(false); // the slip empties and closes at once
    goBets(); // see the slip in My Bets straight away
    const res = await run({
      // one key per slip (not one for the whole app): a second, different slip placed while the first is still travelling must not be dropped
      key: `bet:place:${stake}:${legs.map((l) => l.fx + l.mk + l.pk).join("|")}`, router, sound: "place",
      sensitive: true, pending: "Placing your bet…", // the slip shows in My Bets at once as open; "Bet placed" is only said once the server has taken the stake
      ok: `Bet placed: ${money(stake)} on ${n === 1 ? "1 match" : `${n} matches`}. Good luck!`,
      request: () => call("/api/bet/slips", { legs: legs.map(({ fx, mk, pk }) => ({ fx, mk, pk })), stakeNaira: stake, requestId: crypto.randomUUID() }),
      effects: [{ store: slipsStore, patch: temp }, { store: game, patch: cash(-stakeKobo) }],
    });
    if (res.failed && !res.skipped) { builder.restore(legs, stake); goSports(); } // refused: your picks come back so nothing is lost
  }

  return (
    <div className="bt-sheet-scrim" onClick={() => builder.open(false)}>
      <div className="bt-sheet slip" role="dialog" aria-label="Bet slip" onClick={(e) => e.stopPropagation()}>
        <i className="bt-sheet-grab" />
        <div className="bt-sheet-head">
          <div><b>Betslip</b><small>{b.legs.length === 1 ? "Single" : `Multiple · ${b.legs.length} matches`}</small></div>
          <button type="button" className="bt-sheet-link" onClick={() => builder.clear()}>Clear all</button>
          <button type="button" className="bt-sheet-x" onClick={() => builder.open(false)} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <ul className="sl-legs">
          {b.legs.map((l) => {
            const gone = closed.includes(l) || closed.some((c) => c.fx === l.fx);
            return (
              <li key={l.fx} className={gone ? "gone" : ""}>
                <div className="sl-l">
                  <b>{pickLabel(l)}</b>
                  <span>{l.home} v {l.away}</span>
                  <small>{marketName(l.mk)}{gone ? " · started, remove it" : ""}</small>
                </div>
                <b className="num sl-o">{odd(l.odds)}</b>
                <button type="button" className="sl-x" onClick={() => builder.remove(l.fx)} aria-label={`Remove ${l.home} v ${l.away}`}><Icon name="close" size={16} /></button>
              </li>
            );
          })}
        </ul>
        <div className="sl-stake">
          <label htmlFor="bt-stake">Stake</label>
          <div className="inp-wrap"><span>₦</span><input id="bt-stake" className="inp" type="text" inputMode="numeric" value={b.stake ? Number(b.stake).toLocaleString("en-NG") : ""} placeholder="0" onChange={(e) => builder.setStake(Number(e.target.value.replace(/\D/g, "")) || 0)} /></div>
          <div className="qk">{QUICK.map((q) => <button key={q} type="button" onClick={() => builder.setStake(q)}>{money(q)}</button>)}</div>
        </div>
        <dl className="sl-sum">
          <div><dt>Total odds</dt><dd className="num">{total.toFixed(2)}</dd></div>
          <div className="big"><dt>Potential win</dt><dd className="num">{moneyK(win)}</dd></div>
        </dl>
        <button type="button" className="bt-primary" disabled={!!bad} onClick={place}>{bad || `Place bet · ${money(stake)}`}</button>
      </div>
    </div>
  );
}