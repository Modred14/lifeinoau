// src/app/invest/page.js
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import Loader from "@/components/Loader";

const RISK = { LOW: "var(--ok)", MEDIUM: "var(--acc)", HIGH: "var(--bad)" };
const MOOD = { BOOM: "📈", STEADY: "➖", SLUMP: "📉", CRASH: "🚨" };

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
  const router = useRouter(),
    [d, setD] = useState(null),
    [loadFailed, setLoadFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [amt, setAmt] = useState({});
  const load = useCallback(async () => {
    const r = await call("/api/invest");
    if (r.status === 401) return loggedOut(router);
    if (r.failed) {
      notifyError(r);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setD(r);
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);

  async function go(body) {
    if (busy) return;
    setBusy(true);
    const r = await call("/api/invest", {
      ...body,
      requestId: crypto.randomUUID(),
    });
    setBusy(false);
    if (r.status === 401) return loggedOut(router);
    if (r.failed) notifyError(r);
    else if (r.duplicate) toast.info("Already done.");
    else toast.success(r.note ?? "Done.");
    load();
  }
  if (!d)
    return loadFailed ? (
      <div className="card">
        <p className="mut">This page didn&apos;t load.</p>
        <button onClick={load}>Try again</button>
      </div>
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
          {MOOD[d.news.regime]} Week {d.week}: {d.news.headline}
        </b>
        <p className="mut">
          Invested {naira(d.investedKobo)} of your {naira(d.capKobo)} limit (
          {naira(room > 0n ? room.toString() : "0")} left). Fee {d.feePercent}%
          on every buy and sell. Selling inside a lock period costs{" "}
          {d.earlyPenaltyPercent}% extra.
        </p>
        <p className="mut">
          Prices move every game week and nothing is guaranteed. You can lose
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
                      disabled={busy}
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
              disabled={busy || Number(amt[p.key] ?? 0) < 1000}
              onClick={() =>
                go({
                  action: "buy",
                  product: p.key,
                  amountNaira: Number(amt[p.key]),
                }).then(() => setAmt({ ...amt, [p.key]: "" }))
              }
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
