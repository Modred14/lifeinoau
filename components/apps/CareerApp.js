// components/apps/CareerApp.js: lives inside the phone (see components/Phone.js)
"use client";
import { useState } from "react";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game, run, cash, bump, canAfford, useResource } from "@/lib/gameStore";
import { confirmAction } from "@/lib/confirm";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";

const k = (n) => "₦" + n.toLocaleString("en-NG");

export default function Career() {
  // Kept between visits: reopening is instant and refreshes quietly. Everything you do here shows at once and is undone if refused.
  const { d, store, load, loadFailed, router } = useResource("/api/career");
  const [tab, setTab] = useState("jobs");
  const [form, setForm] = useState({ type: "", name: "" }),
    [amt, setAmt] = useState({});

  // fx = { local: change to this screen, me: change to your stats / cash, ok: message shown at once, okLate: message when the server answers }
  const go = (path, body, fx = {}) =>
    run({
      key: `${path}:${body.action}:${body.id ?? body.job ?? ""}`,
      router,
      ok: fx.ok,
      sensitive: !!fx.pending, // money moves: a spinner shows while the server confirms, and the result is announced when it answers
      pending: fx.pending,
      okLate: fx.okLate ?? ((r) => r.note ?? "Done."),
      request: () => call(path, { ...body, requestId: crypto.randomUUID() }),
      effects: [
        fx.local && { store, patch: fx.local },
        fx.me && { store: game, patch: fx.me },
      ],
      after: fx.after,
    });
  const patchBiz = (id, change) => (x) => ({
    ...x,
    businesses: x.businesses.map((b) => (b.id === id ? { ...b, ...change(b) } : b)),
  });
  const job = (action, extra) => {
    const j = d.job;
    if (action === "work") {
      if (game.get() && game.get().character.energy < j.energy)
        return toast.error("You are too tired for a shift.");
      return go("/api/career/job", { action }, {
        local: (x) => ({
          ...x,
          job: {
            ...x.job,
            xp: x.job.xp + 1,
            level: Math.min(10, Math.floor((x.job.xp + 1) / 5)),
            shiftsToNext: x.job.shiftsToNext <= 1 ? 5 : x.job.shiftsToNext - 1,
            shiftsThisWeek: x.job.shiftsThisWeek + 1,
          },
        }),
        me: bump({ energy: -j.energy }), // the pay is random: it is added the moment the server says how much
        after: (r) => [{ store: game, patch: cash(r.paidKobo ?? 0) }],
        okLate: (r) =>
          `Shift done. You earned ${naira(r.paidKobo)}.${r.levelUp ? ` You reached job level ${r.levelUp}!` : ""}`,
      });
    }
    if (action === "quit")
      return go("/api/career/job", { action }, {
        ok: "You quit your job.",
        local: (x) => ({ ...x, job: null }),
      });
    const x = d.jobs.find((y) => y.key === extra.job),
      same = j?.key === x.key;
    return go("/api/career/job", { action, ...extra }, {
      ok: `You are now a ${x.title}.`,
      local: (v) => {
        const xp = same ? v.job.xp : 0;
        return {
          ...v,
          job: {
            key: x.key, title: x.title, xp, level: Math.min(10, Math.floor(xp / 5)),
            shiftsToNext: 5 - (xp % 5), shiftsThisWeek: v.job?.shiftsThisWeek ?? 0,
            maxShifts: v.job?.maxShifts ?? 5, energy: x.energy,
          },
        };
      },
    });
  };
  const biz = (action, id, extra = {}) => {
    const b = d.businesses.find((y) => y.id === id),
      n = BigInt(Math.max(0, Number(extra.amountNaira) || 0)) * 100n;
    const base = { action, id, ...extra };
    switch (action) {
      case "hire":
        return go("/api/career/business", base, {
          local: patchBiz(id, (y) => ({ employees: Math.min(y.maxEmployees, y.employees + 1) })),
        });
      case "fire":
        return go("/api/career/business", base, {
          local: patchBiz(id, (y) => ({ employees: Math.max(0, y.employees - 1) })),
        });
      case "capital":
        if (!canAfford(n)) return toast.error("You cannot afford that.");
        return go("/api/career/business", base, {
          local: patchBiz(id, (y) => ({ capitalKobo: (BigInt(y.capitalKobo) + n).toString() })),
          me: cash(-n),
          pending: "Adding capital…",
        });
      case "withdraw":
        return go("/api/career/business", base, {
          local: patchBiz(id, (y) => ({ capitalKobo: (BigInt(y.capitalKobo) - n).toString() })),
          me: cash(n),
          pending: "Withdrawing…",
        });
      case "upgrade":
        return go("/api/career/business", base, {
          pending: "Upgrading…",
          local: patchBiz(id, (y) => ({
            level: y.level + 1,
            capitalKobo: (BigInt(y.capitalKobo) - BigInt(y.upgradeCostKobo ?? 0)).toString(),
          })),
        });
      case "close":
        return go("/api/career/business", base, {
          local: (x) => ({ ...x, businesses: x.businesses.filter((y) => y.id !== id) }),
          me: cash(BigInt(b.capitalKobo)),
          pending: "Closing the business…",
        });
      default: // starting a business: the server picks its id, so it appears when the server answers
        return go("/api/career/business", base, { pending: "Starting your business…" });
    }
  };
  if (!d)
    return loadFailed ? (
      <LoadError onRetry={load} />
    ) : (
      <Loader label="Loading jobs" />
    );
  const j = d.job,
    room = d.maxBusinesses - d.businesses.length;

  return (
    <>
      <div className="top">
        <h2>Career</h2>
        <a href="/home">
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
                  disabled={j.shiftsThisWeek >= j.maxShifts}
                  onClick={() => job("work")}
                >
                  Work a shift
                </button>
                <button
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
                  disabled={!!x.locked || j?.key === x.key}
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
                  <button onClick={() => biz("hire", b.id)}>
                    Hire
                    <br />
                    <span className="mut">more sales, more wages</span>
                  </button>
                  <button onClick={() => biz("fire", b.id)}>
                    Let one go
                  </button>
                  <button
                    disabled={!b.upgradeCostKobo}
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
                    disabled={!amt[b.id]}
                    onClick={() =>
                      biz("capital", b.id, { amountNaira: Number(amt[b.id]) })
                    }
                  >
                    Add capital
                  </button>
                  <button
                    disabled={!amt[b.id]}
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
                disabled={!form.type || form.name.trim().length < 3}
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