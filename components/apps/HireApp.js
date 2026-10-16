// components/apps/HireApp.js: lives inside the phone (see components/Phone.js)
// Hire a driver for your car. With a driver on the payroll a trip in your own car takes 5 seconds and the driver does the driving;
// without one you steer yourself. Paying shows at once: the wallet changes and the driver appears in the travel sheet on the map.
"use client";
import { useState } from "react";
import { call, naira } from "@/lib/client";
import { Icon } from "../Icon";
import { confirmAction } from "@/lib/confirm";
import { game, run, cash, canAfford, useResource } from "@/lib/gameStore";
import { DRIVER_PLANS, driverNameFor, RIDE_SECONDS } from "@/lib/travel.js";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import "./hire-app.css";

const weeksText = (n) => `${n} week${n === 1 ? "" : "s"}`;

export default function HireApp({ onClose }) {
  const { d, store, load, loadFailed, router } = useResource("/api/hire");
  const [busy, setBusy] = useState(null);
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Finding drivers" />;

  async function hire(p) {
    const price = BigInt(p.priceKobo);
    if (!canAfford(price)) return;
    const name = d.driver?.name ?? driverNameFor(game.get()?.character?.id ?? "");
    if (!(await confirmAction({
      title: d.driver ? `Keep ${d.driver.name} for ${p.weeks} more week${p.weeks === 1 ? "" : "s"}?` : `Hire ${name} for ${weeksText(p.weeks)}?`,
      message: `You pay ${naira(p.priceKobo)} now. While ${d.driver?.name ?? name} works for you, trips in your own car take ${RIDE_SECONDS.driver} seconds and you do not have to drive. The ₦500 fuel for each trip is still paid when you arrive.`,
      confirmLabel: `Pay ${naira(p.priceKobo)}`,
    }))) return;
    setBusy(p.weeks);
    await run({
      key: "hire:driver",
      router,
      sensitive: true,
      pending: `Hiring ${name}…`,
      ok: `${name} is your driver for ${weeksText(d.driver ? d.driver.weeksLeft + p.weeks : p.weeks)}.`,
      sound: "coin",
      request: () => call("/api/hire", { weeks: p.weeks, requestId: crypto.randomUUID() }),
      effects: [
        { store, patch: (x) => ({ ...x, driver: { name, weeksLeft: (x.driver?.weeksLeft ?? 0) + p.weeks, untilWeek: x.week + (x.driver?.weeksLeft ?? 0) + p.weeks - 1 } }) },
        { store: game, patch: (s) => ({ ...cash(-price)(s), character: { ...s.character, driverName: name, driverUntilWeek: Math.max(s.character.driverUntilWeek >= s.week ? s.character.driverUntilWeek : s.week - 1, 0) + p.weeks } }) },
      ],
    });
    setBusy(null);
  }

  if (!d.hasCar)
    return (
      <div className="hr">
        <div className="hr-empty">
          <span className="hr-ico"><Icon name="ride" size={28} weight="fill" /></span>
          <b>You do not have a car</b>
          <span>A driver drives your own car, so you need one first. Until then you can trek, take a keke or catch a bus from the map.</span>
        </div>
      </div>
    );

  return (
    <div className="hr">
      <div className="hr-now" data-on={d.driver ? "1" : undefined}>
        <span className="hr-now-ico"><Icon name="driver" size={24} weight="fill" /></span>
        <div>
          {d.driver ? (
            <>
              <small>Your driver</small>
              <b>{d.driver.name}</b>
              <span>Paid for {weeksText(d.driver.weeksLeft)} more</span>
            </>
          ) : (
            <>
              <small>Your driver</small>
              <b>No driver hired</b>
              <span>You drive your car yourself</span>
            </>
          )}
        </div>
      </div>
      <p className="hr-note">
        With a driver, trips in your car take {RIDE_SECONDS.driver} seconds and you sit back. You pay the driver up front for a number of weeks (a week is 7 days); the ₦500 fuel is still paid on arrival.
      </p>
      {d.plans.map((p) => {
        const poor = !canAfford(p.priceKobo), per = Math.round(Number(BigInt(p.priceKobo) / 100n) / p.weeks), best = p.weeks === DRIVER_PLANS[DRIVER_PLANS.length - 1].weeks;
        return (
          <article className="hr-card" key={p.weeks}>
            <div className="hr-top">
              <b>{weeksText(p.weeks)}</b>
              {best && <em className="hr-tag">Best value</em>}
            </div>
            <span className="hr-price"><b className="num">{naira(p.priceKobo)}</b> <span>· about {naira(String(per * 100))} a week</span></span>
            <button type="button" className="go hr-go" disabled={busy != null || poor} onClick={() => hire(p)}>
              {busy === p.weeks ? "Paying…" : poor ? `Need ${naira(p.priceKobo)}` : d.driver ? `Add ${weeksText(p.weeks)}` : `Hire for ${weeksText(p.weeks)}`}
            </button>
          </article>
        );
      })}
      {onClose && <button type="button" className="ghost hr-map" onClick={onClose}>Back to the game</button>}
    </div>
  );
}