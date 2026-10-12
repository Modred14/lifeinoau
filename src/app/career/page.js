// src/app/career/page.js
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import Loader from "@/components/Loader";

const k = (n) => "₦" + n.toLocaleString("en-NG");

export default function Career() {
  const router = useRouter(),
    [d, setD] = useState(null),
    [loadFailed, setLoadFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("jobs");
  const [form, setForm] = useState({ type: "", name: "" }),
    [amt, setAmt] = useState({});
  const load = useCallback(async () => {
    const r = await call("/api/career");
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

  async function go(path, body, ok) {
    if (busy) return;
    setBusy(true);
    const r = await call(path, { ...body, requestId: crypto.randomUUID() });
    setBusy(false);
    if (r.status === 401) return loggedOut(router);
    if (r.failed) notifyError(r);
    else if (r.duplicate) toast.info("Already done.");
    else
      toast.success(
        r.note ??
          (r.paidKobo
            ? `Shift done. You earned ${naira(r.paidKobo)}.${r.levelUp ? ` You reached job level ${r.levelUp}!` : ""}`
            : (ok ?? "Done.")),
      );
    load();
  }
  const job = (action, extra) => go("/api/career/job", { action, ...extra });
  const biz = (action, id, extra) =>
    go("/api/career/business", { action, id, ...extra });
  if (!d)
    return loadFailed ? (
      <div className="card">
        <p className="mut">This page didn&apos;t load.</p>
        <button onClick={load}>Try again</button>
      </div>
    ) : (
      <Loader label="Loading jobs" />
    );
  const j = d.job,
    room = d.maxBusinesses - d.businesses.length;

  return (
    <>
      <div className="top">
        <h2>Career</h2>
        <a href="/play">
          <button>Back to game</button>
        </a>
      </div>
      <div className="row" role="tablist">
        {[
          ["jobs", "Jobs"],
          ["biz", `Businesses (${d.businesses.length}/${d.maxBusinesses})`],
        ].map(([t, l]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "jobs" && (
        <>
          {j && (
            <div className="card">
              <div className="top">
                <h2>{j.title}</h2>
                <span className="mut">job level {j.level}</span>
              </div>
              <p className="mut">
                {j.shiftsThisWeek} of {j.maxShifts} shifts this week ·{" "}
                {j.shiftsToNext} more for the next level · each shift costs{" "}
                {j.energy} energy
              </p>
              <div className="row">
                <button
                  className="go"
                  disabled={busy || j.shiftsThisWeek >= j.maxShifts}
                  onClick={() => job("work")}
                >
                  Work a shift
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmAction({
                        title: "Quit your job?",
                        message: "You lose your job experience.",
                        confirmLabel: "Quit job",
                        cancelLabel: "Keep job",
                        tone: "danger",
                      })
                    )
                      job("quit");
                  }}
                >
                  Quit
                </button>
              </div>
            </div>
          )}
          <div className="card">
            <b>{j ? "Switch job (resets experience)" : "Pick a job"}</b>
            {d.jobs.map((x) => (
              <div className="led" key={x.key}>
                <span>
                  {x.title}
                  <br />
                  <span className="mut">
                    {k(x.payMin)}–{k(x.payMax)} a shift · {x.energy} energy
                    {x.locked ? ` · ${x.locked}` : ""}
                  </span>
                </span>
                <button
                  disabled={busy || !!x.locked || j?.key === x.key}
                  onClick={() => job("pick", { job: x.key })}
                >
                  {j?.key === x.key ? "Current" : "Take"}
                </button>
              </div>
            ))}
            <p className="mut">
              Pay grows 12% for every job level. Five shifts use most of your
              energy, so there is a trade-off with studying.
            </p>
          </div>
        </>
      )}

      {tab === "biz" && (
        <>
          {d.businesses.map((b) => {
            const net = BigInt(b.expectedNetKobo),
              room2 = BigInt(b.capitalKobo) - BigInt(b.reserveKobo);
            return (
              <div className="card" key={b.id}>
                <div className="top">
                  <h2>{b.name}</h2>
                  <span className="cash">{naira(b.capitalKobo)}</span>
                </div>
                <p className="mut">
                  {b.label} · level {b.level} · {b.employees}/{b.maxEmployees}{" "}
                  staff · reputation {b.reputation}
                </p>
                <p>
                  Typical week:{" "}
                  <b className={net >= 0n ? "ok" : "bad"}>
                    {net >= 0n ? "+" : ""}
                    {naira(net.toString())}
                  </b>{" "}
                  <span className="mut">(varies, and events can hit hard)</span>
                </p>
                {room2 < 0n && (
                  <p className="bad">
                    Below the safety reserve. A bad week could bankrupt this
                    business.
                  </p>
                )}
                <div className="row">
                  <button disabled={busy} onClick={() => biz("hire", b.id)}>
                    Hire
                    <br />
                    <span className="mut">more sales, more wages</span>
                  </button>
                  <button disabled={busy} onClick={() => biz("fire", b.id)}>
                    Let one go
                  </button>
                  <button
                    disabled={busy || !b.upgradeCostKobo}
                    onClick={() => biz("upgrade", b.id)}
                  >
                    Upgrade
                    <br />
                    <span className="mut">
                      {b.upgradeCostKobo
                        ? naira(b.upgradeCostKobo) + " from capital"
                        : "max level"}
                    </span>
                  </button>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Amount in naira"
                    value={amt[b.id] ?? ""}
                    onChange={(e) =>
                      setAmt({
                        ...amt,
                        [b.id]: e.target.value.replace(/\D/g, ""),
                      })
                    }
                  />
                  <button
                    disabled={busy || !amt[b.id]}
                    onClick={() =>
                      biz("capital", b.id, { amountNaira: Number(amt[b.id]) })
                    }
                  >
                    Add capital
                  </button>
                  <button
                    disabled={busy || !amt[b.id]}
                    onClick={() =>
                      biz("withdraw", b.id, { amountNaira: Number(amt[b.id]) })
                    }
                  >
                    Withdraw
                  </button>
                </div>
                <p className="mut">
                  Safety reserve: {naira(b.reserveKobo)}. Volatile businesses
                  need a bigger cushion.
                </p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmAction({
                        title: `Close ${b.name}?`,
                        message:
                          "Its capital comes back to you, but the business is gone for good.",
                        confirmLabel: "Close business",
                        cancelLabel: "Keep it open",
                        tone: "danger",
                      })
                    )
                      biz("close", b.id);
                  }}
                >
                  Close business
                </button>
              </div>
            );
          })}
          {room > 0 ? (
            <div className="card">
              <b>Start a business</b>
              <p className="mut">
                At your level you can run {d.maxBusinesses}. The price becomes
                its starting capital.
              </p>
              <div className="row">
                {d.types.map((t) => (
                  <button
                    key={t.type}
                    className={form.type === t.type ? "on" : ""}
                    onClick={() => setForm({ ...form, type: t.type })}
                  >
                    {t.label}
                    <br />
                    <span className="mut">{naira(t.costKobo)}</span>
                  </button>
                ))}
              </div>
              <input
                type="text"
                maxLength={24}
                placeholder="Business name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ marginTop: 8 }}
              />
              <button
                className="go"
                style={{ width: "100%", marginTop: 8 }}
                disabled={busy || !form.type || form.name.trim().length < 3}
                onClick={() =>
                  biz("start", undefined, {
                    type: form.type,
                    name: form.name,
                  }).then(() => setForm({ type: "", name: "" }))
                }
              >
                Open for business
              </button>
            </div>
          ) : (
            <div className="card">
              <p className="mut">
                You are running the most businesses your level allows. Level up
                to open more.
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
