// components/apps/RideApp.js: lives inside the phone (see components/Phone.js)
// YK Autos in your pocket: browse the showroom, buy a car, and choose which one you drive. The car you buy is the car the map drives
// (lib3d/vehicles.js draws the same body in the 3D preview and on the road). Buying is a server-checked purchase: the wallet changes at
// once as a pending state, "bought" only appears after the server has said yes, and a repeat request can never charge twice.
"use client";
import { useState } from "react";
import { call, naira } from "@/lib/client";
import { Icon } from "../Icon";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { game, run, cash, canAfford, useResource } from "@/lib/gameStore";
import CarPreview from "../CarPreview";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import "./ride-app.css";

const BASIS = { listings: "Dealer listings", estimate: "Market estimate" };

export default function RideApp({ onClose }) {
  const { d, store, load, loadFailed, router } = useResource("/api/rides");
  const [tab, setTab] = useState("shop"), [sel, setSel] = useState(null), [pick, setPick] = useState(null), [busy, setBusy] = useState(false);
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Opening YK Autos" />;

  const owns = (id) => d.owned.find((o) => o.modelId === id), car = sel ? d.cars.find((c) => c.id === sel) : null;
  const paintName = (hex) => d.paints.find((p) => p.id === hex)?.name ?? "";

  async function buy(c, color) {
    const price = BigInt(c.priceKobo);
    if (!canAfford(price)) return toast.error(`You need ${naira(c.priceKobo)} to buy the ${c.name}. You have ${naira(game.get()?.balanceKobo ?? "0")}.`);
    if (!(await confirmAction({
      title: `Buy the ${c.name}?`,
      message: `${c.year} · ${c.condition} · ${c.fixedPaint ? "bare steel" : paintName(color)}. You pay ${naira(c.priceKobo)} now and the car is yours for good. It becomes the car you drive on the map, and the ₦500 fuel for each trip is still paid when you arrive.${c.basis === "estimate" ? " This price is a market estimate, not a dealer quote." : ""}`,
      confirmLabel: `Pay ${naira(c.priceKobo)}`,
    }))) return;
    setBusy(true);
    const res = await run({
      key: "ride:buy:" + c.id, router, sensitive: true, pending: `Buying the ${c.name}…`, ok: `The ${c.name} is yours. It is in your garage.`, sound: "coin",
      request: () => call("/api/rides", { action: "buy", modelId: c.id, color, requestId: crypto.randomUUID() }),
      effects: [
        { store, patch: (x) => ({ ...x, owned: x.owned.some((o) => o.modelId === c.id) ? x.owned : [...x.owned, { modelId: c.id, color: c.fixedPaint ?? color }], active: c.id, activeColor: c.fixedPaint ?? color }) },
        { store: game, patch: (s) => ({ ...cash(-price)(s), character: { ...s.character, activeCar: c.id, activeCarColor: c.fixedPaint ?? color } }) },
      ],
    });
    setBusy(false);
    if (!res.failed) { setSel(null); setTab("garage"); }
  }

  async function drive(modelId, name, color) {
    await run({
      key: "ride:use", router, ok: modelId ? `You will drive the ${name}.` : "You will drive your family car.",
      request: () => call("/api/rides", { action: "use", modelId }),
      effects: [
        { store, patch: (x) => ({ ...x, active: modelId, activeColor: color ?? "" }) },
        { store: game, patch: (s) => ({ ...s, character: { ...s.character, activeCar: modelId, activeCarColor: color ?? "" } }) },
      ],
    });
  }

  // ---- one car ----
  if (car) {
    const mine = owns(car.id), color = car.fixedPaint ?? pick ?? mine?.color ?? d.paints[0].id, sale = car.priceKobo != null, poor = sale && !canAfford(car.priceKobo);
    return (
      <div className="rd">
        <button type="button" className="ghost rd-back" onClick={() => { setSel(null); setPick(null); }}><Icon name="left" size={16} /> YK Autos</button>
        <div className="rd-stage"><CarPreview modelId={car.id} paint={mine?.color ?? color} label={`3D preview of the ${car.name}`} /></div>
        <div className="rd-head"><b>{car.name}</b><span>{car.year} · {car.condition} · {car.body}</span></div>
        <ul className="rd-specs">{car.specs.map((s) => <li key={s}>{s}</li>)}</ul>
        {!mine && !car.fixedPaint && (
          <div className="rd-paints" role="radiogroup" aria-label="Paint">
            {d.paints.map((p) => <button key={p.id} type="button" role="radio" aria-checked={color === p.id} aria-label={p.name} className="rd-dot" data-on={color === p.id ? "1" : undefined} style={{ background: p.id }} onClick={() => setPick(p.id)} />)}
          </div>
        )}
        {!mine && <div className="rd-paintname">{car.fixedPaint ? "Bare steel" : paintName(color)}</div>}
        <div className="rd-price">
          {sale ? <><b className="num">{naira(car.priceKobo)}</b><em className="rd-tag" data-k={car.basis}>{BASIS[car.basis]}</em></> : <><b>Price being verified</b><em className="rd-tag" data-k="none">Not for sale yet</em></>}
        </div>
        <p className="rd-note">{car.note}</p>
        {mine ? (
          <>
            <div className="rd-own"><Icon name="ride" size={18} weight="fill" /> {d.active === car.id ? "You drive this car" : "In your garage"}</div>
            {d.active !== car.id && <button type="button" className="go rd-go" onClick={() => drive(car.id, car.name, mine.color)}>Drive this one</button>}
          </>
        ) : (
          <button type="button" className="go rd-go" disabled={!sale || busy} data-poor={poor ? "1" : undefined} onClick={() => buy(car, color)}>
            {!sale ? "Not for sale yet" : busy ? "Buying…" : poor ? `Need ${naira(car.priceKobo)}` : `Buy for ${naira(car.priceKobo)}`}
          </button>
        )}
      </div>
    );
  }

  // ---- showroom and garage ----
  const garage = d.owned.map((o) => ({ ...d.cars.find((c) => c.id === o.modelId), color: o.color })).filter((c) => c.id);
  return (
    <div className="rd">
      <div className="rd-hero"><span className="rd-logo">YK</span><div><b>YK Autos</b><span>Cars for the road to everywhere</span></div></div>
      <div className="rd-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "shop"} onClick={() => setTab("shop")}>Showroom</button>
        <button type="button" role="tab" aria-selected={tab === "garage"} onClick={() => setTab("garage")}>My garage{garage.length ? ` · ${garage.length}` : ""}</button>
      </div>
      {tab === "shop" && d.cars.map((c) => (
        <button type="button" key={c.id} className="rd-card" onClick={() => setSel(c.id)}>
          <span className="rd-ico"><Icon name="ride" size={22} weight="fill" /></span>
          <span className="rd-main"><b>{c.name}</b><small>{c.year} · {c.condition} · {c.body}</small>
            <span className="rd-line">{c.priceKobo != null ? <b className="num">{naira(c.priceKobo)}</b> : <span className="rd-soon">Price being verified</span>}{owns(c.id) && <em className="rd-tag" data-k="own">Owned</em>}</span>
          </span>
        </button>
      ))}
      {tab === "garage" && (
        <>
          {d.family && (
            <div className="rd-card rd-static"><span className="rd-ico"><Icon name="ride" size={22} weight="fill" /></span>
              <span className="rd-main"><b>Family car</b><small>Daddy Benz</small></span>
              {d.active === "" ? <em className="rd-tag" data-k="own">Driving</em> : <button type="button" className="go rd-use" onClick={() => drive("", "", "")}>Drive</button>}
            </div>
          )}
          {garage.map((c) => (
            <div className="rd-card rd-static" key={c.id}><span className="rd-ico"><Icon name="ride" size={22} weight="fill" /></span>
              <span className="rd-main"><b>{c.name}</b><small>{c.year} · {c.condition}</small></span>
              {d.active === c.id ? <em className="rd-tag" data-k="own">Driving</em> : <button type="button" className="go rd-use" onClick={() => drive(c.id, c.name, c.color)}>Drive</button>}
            </div>
          ))}
          {!garage.length && !d.family && <div className="rd-empty"><b>Your garage is empty</b><span>Buy a car in the showroom and it will wait for you here.</span></div>}
        </>
      )}
      {onClose && <button type="button" className="ghost rd-map" onClick={onClose}>Back to the game</button>}
    </div>
  );
}