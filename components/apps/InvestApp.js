// components/apps/InvestApp.js: lives inside the phone (see components/Phone.js)
"use client";
import { useState } from "react";
import { call, naira } from "@/lib/client";
import { Icon } from "../Icon";
import { toast } from "@/lib/toast";
import { game, run, cash, canAfford, useResource } from "@/lib/gameStore";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";

const RISK = { LOW: "var(--ok)", MEDIUM: "var(--acc)", HIGH: "var(--bad)" };
const MOOD = { BOOM: "invest", STEADY: "news", SLUMP: "down", CRASH: "warn" };

function Spark({ data, label }) {
  // tiny price chart: no chart library needed
  const w = 120,
    h = 36,
    lo = Math.min(...data),
    hi = Math.max(...data),
    span = hi - lo || 1;
  const pts = data
    .map(
      (v, i) =>
        `${(i / Math.max(1, data.length - 1)) * w},${h - 3 - ((v - lo) / span) * (h - 6)}`,
    )
    .join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "var(--ok)" : "var(--bad)"}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Invest() {
  // Kept between visits: reopening is instant and refreshes quietly.
  const { d, store, load, loadFailed, router } = useResource("/api/invest");
  const [amt, setAmt] = useState({});
  const NGN = (k) => (k / 100n).toLocaleString("en-NG");

  // Buying and selling show at once (your holdings, your cash, the invested total) using the same fee and penalty maths as the server,
  // and are undone if the server refuses. The prices only change once a week, so nothing here depends on luck.
  function go(body) {
    const P = d.products.find((p) => p.key === body.product),
      h = d.holdings.find((x) => x.product === body.product),
      fee = BigInt(d.feePercent);
    let local, me, ok;
    if (body.action === "buy") {
      const amount = BigInt(body.amountNaira) * 100n,
        f = (amount * fee) / 100n;
      if (!canAfford(amount + f))
        return toast.error("You cannot afford that (the 1% fee is added on top).");
      ok = `Bought ${P.name}. Fee ₦${NGN(f)}.`;
      me = cash(-(amount + f));
      local = (x) => {
        const old = x.holdings.find((y) => y.product === body.product);
        return {
          ...x,
          investedKobo: (BigInt(x.investedKobo) + amount).toString(),
          holdings: old
            ? x.holdings.map((y) =>
                y.product !== body.product ? y : {
                  ...y,
                  valueKobo: (BigInt(y.valueKobo) + amount).toString(),
                  costKobo: (BigInt(y.costKobo) + amount).toString(),
                  lockedWeeks: P.lock,
                })
            : [...x.holdings, { product: body.product, name: P.name, valueKobo: amount.toString(), costKobo: amount.toString(), pnlKobo: "0", lockedWeeks: P.lock }],
        };
      };
    } else {
      const pc = BigInt(body.percent),
        value = (BigInt(h.valueKobo) * pc) / 100n,
        early = h.lockedWeeks > 0,
        penalty = early ? (value * BigInt(d.earlyPenaltyPercent)) / 100n : 0n,
        net = value - penalty - (value * fee) / 100n;
      ok = `Sold. You received ₦${NGN(net)}${early ? ` after a ${d.earlyPenaltyPercent}% early-sale penalty` : ""}.`;
      me = net > 0n ? cash(net) : null;
      local = (x) => ({
        ...x,
        investedKobo: (BigInt(x.investedKobo) - value).toString(),
        holdings:
          pc === 100n
            ? x.holdings.filter((y) => y.product !== body.product)
            : x.holdings.map((y) => {
                if (y.product !== body.product) return y;
                const v = BigInt(y.valueKobo) - value, c = BigInt(y.costKobo) - (BigInt(y.costKobo) * pc) / 100n;
                return { ...y, valueKobo: v.toString(), costKobo: c.toString(), pnlKobo: (v - c).toString() };
              }),
      });
    }
    return run({
      key: `invest:${body.action}:${body.product}`,
      router,
      sensitive: true, // money in or out: "bought" / "sold" is only said once the server has confirmed it
      pending: body.action === "buy" ? `Buying ${P.name}…` : `Selling ${P.name}…`,
      ok,
      request: () => call("/api/invest", { ...body, requestId: crypto.randomUUID() }),
      effects: [{ store, patch: local }, me && { store: game, patch: me }],
    });
  }
  if (!d)
    return loadFailed ? (
      <LoadError onRetry={load} />
    ) : (
      <Loader label="Loading markets" />
    );
  const room = BigInt(d.capKobo) - BigInt(d.investedKobo),
    held = Object.fromEntries(d.holdings.map((h) => [h.product, h]));

  return (
    <>
      <div className="top">
        <h2>Invest</h2>
        <a href="/play">
          <button>Back to game</button>
        </a>
      </div>
      <div className="card">
        <b>
          <Icon name={MOOD[d.news.regime] ?? "news"} size={18} /> Week {d.week}: {d.news.headline}
        </b>
        <p className="mut">
          Invested {naira(d.investedKobo)} of your {naira(d.capKobo)} limit (
          {naira(room > 0n ? room.toString() : "0")} left). Fee {d.feePercent}%
          on every buy and sell. Selling inside a lock period costs{" "}
          {d.earlyPenaltyPercent}% extra.
        </p>
        <p className="mut">
          Prices move every week and nothing is guaranteed. You can lose
          money, and high-risk products usually do.
        </p>
      </div>

      {d.holdings.length > 0 && (
        <div className="card">
          <b>Your investments</b>
          {d.holdings.map((h) => {
            const pnl = BigInt(h.pnlKobo);
            return (
              <div className="led" key={h.product} style={{ display: "block" }}>
                <div className="top">
                  <span>
                    <b>{h.name}</b>
                  </span>
                  <b>{naira(h.valueKobo)}</b>
                </div>
                <p className="mut">
                  Paid {naira(h.costKobo)} ·{" "}
                  <span className={pnl >= 0n ? "ok" : "bad"}>
                    {pnl >= 0n ? "+" : ""}
                    {naira(pnl.toString())}
                  </span>
                  {h.lockedWeeks > 0 &&
                    ` · locked ${h.lockedWeeks} more week(s): selling now costs ${d.earlyPenaltyPercent}% extra`}
                </p>
                <div className="row">
                  {[25, 50, 100].map((p) => (
                    <button
                      key={p}
                      onClick={() =>
                        go({ action: "sell", product: h.product, percent: p })
                      }
                    >
                      Sell {p === 100 ? "all" : p + "%"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {d.products.map((p) => (
        <div className="card" key={p.key}>
          <div className="top">
            <h2>{p.name}</h2>
            <span
              className="msg"
              style={{
                margin: 0,
                padding: "2px 10px",
                color: RISK[p.risk],
                borderColor: RISK[p.risk],
              }}
            >
              {p.risk}
            </span>
          </div>
          <p className="mut">
            {p.blurb}
            {p.lock > 0 && ` Locked ${p.lock} week(s) after each buy.`}
          </p>
          <div className="top">
            <span className="cash">
              {naira(p.priceKobo)}
              <span className="mut"> / unit</span>
            </span>
            <Spark
              data={p.history}
              label={`${p.name} price, last ${p.history.length} weeks`}
            />
          </div>
          <p className={p.changePct >= 0 ? "ok" : "bad"}>
            {p.changePct >= 0 ? "+" : ""}
            {p.changePct}% this week
            {held[p.key] && (
              <span className="mut">
                {" "}
                · you hold {naira(held[p.key].valueKobo)}
              </span>
            )}
          </p>
          <div className="row">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Amount in naira"
              aria-label={`Amount to invest in ${p.name}`}
              value={amt[p.key] ?? ""}
              onChange={(e) =>
                setAmt({ ...amt, [p.key]: e.target.value.replace(/\D/g, "") })
              }
            />
            <button
              className="go"
              disabled={Number(amt[p.key] ?? 0) < 1000}
              onClick={() => {
                const n = Number(amt[p.key]);
                setAmt({ ...amt, [p.key]: "" }); // the box clears at once, like the rest of the screen
                go({ action: "buy", product: p.key, amountNaira: n });
              }}
            >
              Buy
            </button>
          </div>
          {Number(amt[p.key] ?? 0) >= 1000 && (
            <p className="mut">
              You pay ₦
              {(
                Number(amt[p.key]) +
                Math.floor((Number(amt[p.key]) * d.feePercent) / 100)
              ).toLocaleString("en-NG")}{" "}
              including the fee.
            </p>
          )}
        </div>
      ))}
    </>
  );
}