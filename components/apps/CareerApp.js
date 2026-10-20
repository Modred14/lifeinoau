// components/apps/CareerApp.js: lives inside the phone (see components/Phone.js)
"use client";
import { useEffect, useState } from "react";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game, run, cash, bump, canAfford, useResource } from "@/lib/gameStore";
import { confirmAction } from "@/lib/confirm";
import { serverTime } from "@/lib/serverClock";
import { waitText } from "@/lib/engine";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";

const k = (n) => "₦" + n.toLocaleString("en-NG");
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const SHIFT_ICON = { morning: "☀", night: "☾" };

export default function Career() {
  // Kept between visits: reopening is instant and refreshes quietly. Everything you do here shows at once and is undone if refused.
  const { d, store, load, loadFailed, router } = useResource("/api/career");
  const [tab, setTab] = useState("jobs");
  // A ticking clock for the shift desk. It is the SERVER's clock (lib/serverClock.js), so two devices agree; the server decides everything that matters.
  const [now, setNow] = useState(() => serverTime());
  useEffect(() => { const t = setInterval(() => setNow(serverTime()), 1000); return () => clearInterval(t); }, []);
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
    // Shifts are decided by the server: clock in (start), clock out and collect (claim) or walk off (abandon). Nothing is paid or taken here
    // until it answers, and the answer is whatever the server worked out from its own clock.
    if (action === "start" || action === "claim" || action === "abandon")
      return go("/api/career/job", { action, ...extra }, {
        pending: action === "claim" ? "Clocking out…" : action === "start" ? "Clocking in…" : "Leaving the shift…",
        okLate: (r) =>
          action === "claim"
            ? r.duplicate ? "That shift was already paid." : `Shift done. You earned ${naira(r.paidKobo)}.${r.levelUp ? ` You reached job level ${r.levelUp}!` : ""}`
            : r.note ?? "Done.",
      }).then((res) => { if (!res?.failed) { load(); game.refresh?.(); } return res; }); // the server's view: new shift state, energy and cash
    if (action === "quit")
      return go("/api/career/job", { action }, {
        ok: "You quit your job.",
        local: (x) => ({ ...x, job: null }),
      });
    // Taking a job: the screen needs the server's full job card (the shift menu, today's limits, the clock), which only the server can work out.
    // An optimistic patch with a half-built job object used to crash the screen (j.shifts was undefined), so the answer is awaited and the card is re-read.
    const x = d.jobs.find((y) => y.key === extra?.job);
    if (!x) return toast.error("That job is not available.");
    return go("/api/career/job", { action, ...extra }, {
      pending: `Taking the ${x.title} job…`,
      okLate: (r) => r.note ?? `You are now a ${x.title}.`,
    }).then((res) => { if (!res?.failed) { load(); game.refresh?.(); } return res; });
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
          {j && (() => {
            const act = j.active, gmin = (d.gameMinute + Math.floor((now - d.serverNow) / 60000)) % 1440;
            const left = act ? Math.max(0, act.endsAt - now) : 0, pct = act ? Math.min(100, Math.round(((now - act.startedAt) / (act.endsAt - act.startedAt)) * 100)) : 0;
            const nextIn = j.nextShiftAt ? Math.max(0, j.nextShiftAt - now) : 0;
            return (
              <div className="card shift-desk">
                <div className="top">
                  <h2>{j.title}</h2>
                  <span className="mut">job level {j.level}</span>
                </div>
                <p className="mut">
                  Game time <b className="num">{hhmm(gmin)}</b> · {j.shiftsThisWeek} of {j.maxShifts} shifts this week · {j.shiftsToNext} more for the next level
                </p>
                {act ? (
                  <div className="shift-on" role="status" aria-live="polite">
                    <b>{SHIFT_ICON[act.shift]} {act.shift === "night" ? "Night" : "Morning"} shift in progress</b>
                    <div className="shift-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + "%" }} /></div>
                    <p className="mut">
                      Clocked in {hhmm(Math.floor(((act.startedAt - d.serverNow) / 60000 + d.gameMinute + 1440 * 2) % 1440))} · ends {hhmm(Math.floor(((act.endsAt - d.serverNow) / 60000 + d.gameMinute + 1440 * 2) % 1440))} ·{" "}
                      {left > 0 ? `${waitText(left)} left` : "finished"} · pays {naira(act.payKobo)}
                    </p>
                    <div className="row">
                      <button className="go" disabled={left > 0} onClick={() => job("claim")}>{left > 0 ? `Clock out in ${waitText(left)}` : `Clock out and collect ${naira(act.payKobo)}`}</button>
                      {left > 0 && (
                        <button
                          onClick={async () => {
                            if (await confirmAction({ title: "Walk off the shift?", message: "You get no pay, the energy is gone and today's shift is used up.", confirmLabel: "Walk off", cancelLabel: "Stay", tone: "danger" })) job("abandon");
                          }}
                        >
                          Walk off
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {(j.shifts ?? []).map((sh) => (
                      <div className="led shift-opt" key={sh.key}>
                        <span>
                          {SHIFT_ICON[sh.key]} <b>{sh.label}</b>
                          <br />
                          <span className="mut">
                            Clock in {sh.window} · {sh.seconds} seconds · {sh.energy} energy · {k(sh.payMin)}–{k(sh.payMax)}
                          </span>
                          {sh.blocked && <><br /><span className="mut shift-why">{sh.blocked}</span></>}
                        </span>
                        <button className="go" disabled={!!sh.blocked} onClick={() => job("start", { shift: sh.key })}>Clock in</button>
                      </div>
                    ))}
                    {j.workedToday && (
                      <p className="mut">
                        You have worked today. Next shift opens at the start of tomorrow{nextIn > 0 ? `, in ${waitText(nextIn)}` : ""}.
                      </p>
                    )}
                  </>
                )}
                <div className="row">
                  <button
                    disabled={!!act}
                    onClick={async () => {
                      if (await confirmAction({ title: "Quit your job?", message: "You lose your job experience.", confirmLabel: "Quit job", cancelLabel: "Keep job", tone: "danger" })) job("quit");
                    }}
                  >
                    Quit
                  </button>
                </div>
              </div>
            );
          })()}
          <div className="card">
            <b>{j ? "Switch job (resets experience)" : "Pick a job"}</b>
            {d.jobs.map((x) => (
              <div className="led" key={x.key}>
                <span>
                  {x.title}
                  <br />
                  <span className="mut">
                    {k(x.payMin)}–{k(x.payMax)} a shift · {x.seconds}s · {x.energy} energy · {x.shifts.map((q) => (q === "night" ? "night" : "morning")).join(" / ")}
                    {x.locked ? ` · ${x.locked}` : ""}
                  </span>
                </span>
                <button
                  disabled={!!x.locked || j?.key === x.key || !!j?.active}
                  onClick={() => job("pick", { job: x.key })}
                >
                  {j?.key === x.key ? "Current" : "Take"}
                </button>
              </div>
            ))}
            <p className="mut">
              One shift a day, five a week. Night shifts pay 25% more and tire you more. Pay grows 12% for every job level.
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