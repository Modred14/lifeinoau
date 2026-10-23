// components/apps/LuxuryApp.js: lives inside the phone (see components/Phone.js)
// Luxury: every premium thing in the game in one place. Designer Elite clothing, the expensive cars of YK Autos, and the club's bottles, VIP packages, experiences
// and buyouts, with visible prices, a search box, category filters and a direct action on each one (buy, wear, drive, or go to the club).
// It adds no new rules: prices, ownership and money come from the same server routes the Clothing and Ride apps use (/api/wardrobe, /api/rides) and the same
// price list the clubs charge from (lib/clubs.js). The two routes share their stores with those apps, so a purchase here shows there at once, and the other way round.
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira } from "@/lib/client";
import { Icon } from "../Icon";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { game, run, cash, canAfford, useGame, useResource } from "@/lib/gameStore";
import { forGender, itemById, priceKobo, fitsGender, STYLES } from "@/lib/wardrobe";
import { CLUBS, CLUB_IDS, DRINKS, PACKAGES, EXPERIENCES, BUYOUT_TIERS, clubStatus } from "@/lib/clubs.js";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import "./luxury-app.css";

const CATS = [["all", "All"], ["clothing", "Clothing"], ["cars", "Vehicles"], ["club", "Club spending"]];
const kobo = (n) => (BigInt(n) * 100n).toString();
const BLACK = "#1f1f23";

export default function LuxuryApp({ onOpenApp, onClose }) {
  const wd = useResource("/api/wardrobe"), rd = useResource("/api/rides"), gs = useGame(), router = useRouter();
  const [cat, setCat] = useState("all"), [q, setQ] = useState(""), [low, setLow] = useState(false), [club, setClub] = useState(CLUB_IDS[0]), [busy, setBusy] = useState(null);
  const w = wd.d, r = rd.d, balance = gs?.balanceKobo ?? w?.balanceKobo ?? "0", status = clubStatus();

  const rows = useMemo(() => {
    const out = [];
    if (w) {
      const owned = new Set(w.owned.map((o) => o.id));
      for (const it of forGender(w.gender).filter((i) => i.tier === "elite" && fitsGender(i, w.gender))) out.push({ key: "c:" + it.id, cat: "clothing", name: it.name, sub: `Elite Collection · ${it.slot === "set" ? "Complete outfit" : STYLES[it.style]}`, price: priceKobo(it).toString(), owned: owned.has(it.id), item: it });
    }
    if (r) for (const c of r.cars) out.push({ key: "v:" + c.id, cat: "cars", name: c.name, sub: `${c.year} · ${c.condition} · ${c.body}`, price: c.priceKobo, owned: r.owned.some((o) => o.modelId === c.id), driving: r.active === c.id, car: c });
    for (const d of DRINKS) out.push({ key: "d:" + d.id, cat: "club", name: d.name, sub: `Bottle · ${d.kind}`, price: kobo(d.priceNaira), club: true });
    for (const p of PACKAGES) out.push({ key: "p:" + p.id, cat: "club", name: p.name, sub: `VIP package · ${p.vipMinutes} minutes of VIP`, price: kobo(p.priceNaira), club: true });
    for (const x of EXPERIENCES) out.push({ key: "x:" + x.id, cat: "club", name: x.name, sub: `Club experience · ${x.summary}`, price: kobo(x.priceNaira), club: true });
    for (const t of BUYOUT_TIERS) out.push({ key: "b:" + t.id, cat: "club", name: t.name, sub: `Club buyout · ${t.minutes} minutes`, price: kobo(CLUBS[club].buyout[t.id]), club: true });
    const needle = q.trim().toLowerCase();
    return out.filter((x) => (cat === "all" || x.cat === cat) && (!needle || `${x.name} ${x.sub}`.toLowerCase().includes(needle)))
      .sort((a, b) => (a.price == null) - (b.price == null) || (low ? 1 : -1) * (Number(BigInt(a.price ?? 0) - BigInt(b.price ?? 0)) > 0 ? 1 : -1));
  }, [w, r, cat, q, low, club]);

  if (!w || !r) return wd.loadFailed || rd.loadFailed ? <LoadError onRetry={() => { wd.load(); rd.load(); }} /> : <Loader label="Opening Luxury" />;

  async function buyClothes(it) {
    const p = priceKobo(it).toString(); if (!canAfford(BigInt(p))) return toast.error(`You need ${naira(p)} to buy ${it.name}. You have ${naira(balance)}.`);
    if (!(await confirmAction({ title: `Buy ${it.name}?`, message: `You pay ${naira(p)} from your bank balance and it is yours for good, in your wardrobe.`, confirmLabel: `Pay ${naira(p)}` }))) return;
    setBusy(it.id);
    await run({ key: "wardrobe:buy:" + it.id, router: wd.router, sensitive: true, pending: `Buying ${it.name}…`, ok: `${it.name} is in your wardrobe.`, sound: "coin",
      request: () => call("/api/wardrobe", { action: "buy", itemId: it.id, requestId: crypto.randomUUID() }),
      effects: [{ store: wd.store, patch: (x) => ({ ...x, owned: x.owned.some((o) => o.id === it.id) ? x.owned : [...x.owned, { id: it.id, paidKobo: p, at: new Date().toISOString() }] }) }, { store: game, patch: cash(-BigInt(p)) }] });
    setBusy(null);
  }
  async function buyCar(c) {
    const color = c.fixedPaint ?? BLACK; if (!canAfford(BigInt(c.priceKobo))) return toast.error(`You need ${naira(c.priceKobo)} to buy the ${c.name}. You have ${naira(balance)}.`);
    if (!(await confirmAction({ title: `Buy the ${c.name}?`, message: `${c.year} · ${c.condition} · ${c.fixedPaint ? "bare steel" : "black paint"}. You pay ${naira(c.priceKobo)} now and the car is yours for good. It becomes the car you drive on the map. Want another colour? Cancel and use Preview and paint.`, confirmLabel: `Pay ${naira(c.priceKobo)}` }))) return;
    setBusy(c.id);
    await run({ key: "ride:buy:" + c.id, router: rd.router, sensitive: true, pending: `Buying the ${c.name}…`, ok: `The ${c.name} is yours. It is in your garage.`, sound: "coin",
      request: () => call("/api/rides", { action: "buy", modelId: c.id, color, requestId: crypto.randomUUID() }),
      effects: [{ store: rd.store, patch: (x) => ({ ...x, owned: x.owned.some((o) => o.modelId === c.id) ? x.owned : [...x.owned, { modelId: c.id, color }], active: c.id, activeColor: color }) },
        { store: game, patch: (s) => ({ ...cash(-BigInt(c.priceKobo))(s), character: { ...s.character, activeCar: c.id, activeCarColor: color } }) }] });
    setBusy(null);
  }
  async function drive(c) {
    const mine = r.owned.find((o) => o.modelId === c.id); setBusy(c.id);
    await run({ key: "ride:use", router: rd.router, ok: `You will drive the ${c.name}.`, request: () => call("/api/rides", { action: "use", modelId: c.id }),
      effects: [{ store: rd.store, patch: (x) => ({ ...x, active: c.id, activeColor: mine?.color ?? "" }) }, { store: game, patch: (s) => ({ ...s, character: { ...s.character, activeCar: c.id, activeCarColor: mine?.color ?? "" } }) }] });
    setBusy(null);
  }
  const goClub = () => { router.push(`/map?to=${club}`); onClose?.(); };

  return (
    <div className="lx">
      <div className="lx-hero"><div><b>Luxury</b><span>Elite clothing, supercars and club nights</span></div><div className="lx-bal"><small>Balance</small><b>{naira(balance)}</b></div></div>
      <div className="lx-search"><Icon name="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search silk, Urus, Louis XIII…" aria-label="Search luxury items" /></div>
      <div className="lx-chips" role="group" aria-label="Category">
        {CATS.map(([id, label]) => <button key={id} type="button" aria-pressed={cat === id} onClick={() => setCat(id)}>{label}</button>)}
        <button type="button" className="lx-sort" onClick={() => setLow(!low)} aria-label={low ? "Sorted by price, lowest first" : "Sorted by price, highest first"}>{low ? "Price ↑" : "Price ↓"}</button>
      </div>
      {(cat === "all" || cat === "club") && (
        <div className="lx-clubs" role="group" aria-label="Choose a club">
          {CLUB_IDS.map((id) => <button key={id} type="button" aria-pressed={club === id} style={{ "--neon": CLUBS[id].neon }} onClick={() => setClub(id)}><i />{CLUBS[id].name}</button>)}
          <small>{status.open ? `Open now. ${status.note}.` : `Closed. ${status.note}.`} Buy at the club, from the VIP menu.</small>
        </div>
      )}
      <div className="lx-shops">
        <button type="button" onClick={() => onOpenApp?.("offishall")}><Icon name="shirt" size={16} /> Clothing store</button>
        <button type="button" onClick={() => onOpenApp?.("ride")}><Icon name="ride" size={16} /> YK Autos</button>
        <button type="button" onClick={() => onOpenApp?.("spending")}><Icon name="receipt" size={16} /> Club spending</button>
      </div>
      {rows.map((x) => (
        <div className="lx-row" key={x.key} data-cat={x.cat}>
          <span className="lx-ico"><Icon name={x.cat === "clothing" ? "shirt" : x.cat === "cars" ? "ride" : "sparkle"} size={20} weight="fill" /></span>
          <span className="lx-main"><b>{x.name}</b><small>{x.sub}</small>
            <span className="lx-price">{x.price != null ? <b className="num">{naira(x.price)}</b> : <em>Price being verified</em>}{x.owned && <em className="lx-own">{x.driving ? "Driving" : "Owned"}</em>}</span></span>
          {x.cat === "clothing" && (x.owned ? <button type="button" onClick={() => onOpenApp?.("offishall")}>Wear</button> : <button type="button" className="go" disabled={busy === x.item.id} onClick={() => buyClothes(x.item)}>Buy</button>)}
          {x.cat === "cars" && (x.owned ? (x.driving ? null : <button type="button" className="go" disabled={busy === x.car.id} onClick={() => drive(x.car)}>Drive</button>) : x.price == null ? <button type="button" onClick={() => onOpenApp?.("ride")}>View</button> : <div className="lx-two"><button type="button" className="go" disabled={busy === x.car.id} onClick={() => buyCar(x.car)}>Buy</button><button type="button" onClick={() => onOpenApp?.("ride")}>Paint</button></div>)}
          {x.club && <button type="button" onClick={goClub}>Go to {CLUBS[club].name}</button>}
        </div>
      ))}
      {!rows.length && <div className="lx-empty"><b>Nothing matches</b><span>Try another word or pick All.</span></div>}
    </div>
  );
}