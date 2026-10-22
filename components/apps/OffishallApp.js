// components/apps/OffishallApp.js: lives inside the phone (see components/Phone.js)
// Offishall Store: browse and buy clothes with your bank balance, then change outfits from your wardrobe.
// The server decides everything that matters (price, ownership, money, a complete outfit: lib/wardrobeService.js). This screen shows it, and shows the REAL 3D
// character in the clothes before you buy or wear them, because the preview is drawn from the same wearable data the game world uses (lib/wardrobe.js).
"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { call, naira } from "@/lib/client";
import { Icon } from "../Icon";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { avatarDirectory } from "@/lib/avatarClient";
import { game, run, cash, canAfford, useGame, useResource } from "@/lib/gameStore";
import { CATEGORIES, STYLES, FINISHES, forGender, itemById, fitsGender, priceKobo, checkWear, outfitWith, previewWith, wearKey } from "@/lib/wardrobe";
import GarmentArt from "../GarmentArt";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import "./offishall-app.css";

const CharacterViewer = dynamic(() => import("../CharacterViewer"), { ssr: false, loading: () => <div className="of-stagewait" aria-busy="true" /> });

const koboOf = (item) => priceKobo(item).toString();
const BASE_NAME = { tee: "T-shirt", hoodie: "Hoodie", croptop: "Crop top", shirt: "Dress shirt", blouse: "Blouse", tunic: "Kaftan", buba: "Buba", jeans: "Jeans", chinos: "Chinos", suit: "Tailored trousers", dress: "Ceremony trousers", work: "Work trousers", shorts: "Shorts", pencil: "Pencil skirt", iro: "Iro wrapper" };
const kindOf = (item) => (item.slot === "set" ? "Complete outfit" : BASE_NAME[Object.values(item.parts)[0].base]);
const finishOf = (item) => [...new Set(Object.values(item.parts).map((p) => FINISHES[p.finish].label))].join(" and ");
const SORTS = { featured: "Featured", low: "Price: low to high", high: "Price: high to low" };
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
const names = (ids) => (ids ?? []).map((i) => itemById(i)?.name).filter(Boolean).join(" + ");

export default function OffishallApp() {
  const { d, store, load, loadFailed, router } = useResource("/api/wardrobe");
  const gs = useGame();
  const [tab, setTab] = useState("store"), [cat, setCat] = useState("all"), [sort, setSort] = useState("featured"), [sel, setSel] = useState(null);
  const [pick, setPick] = useState({ set: null, top: null, bottom: null }), [busy, setBusy] = useState(false);
  const worn = d?.wear ?? null;
  const wornKey = wearKey(worn);

  // The wardrobe selection starts from what is being worn, and follows it when the outfit changes.
  useEffect(() => {
    const items = (worn ?? []).map(itemById).filter(Boolean);
    setPick({ set: items.find((i) => i.slot === "set")?.id ?? null, top: items.find((i) => i.slot === "top")?.id ?? null, bottom: items.find((i) => i.slot === "bottom")?.id ?? null });
  }, [wornKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const gender = d?.gender ?? "M";
  const ownedIds = useMemo(() => (d ? d.owned.map((o) => o.id) : []), [d]);
  const owns = (id) => ownedIds.includes(id);
  const mine = useMemo(() => ownedIds.map(itemById).filter((i) => i && fitsGender(i, gender)), [ownedIds, gender]);
  const shelf = useMemo(() => {
    let list = forGender(gender).filter((i) => cat === "all" || i.category === cat);
    if (sort !== "featured") list = [...list].sort((a, b) => (sort === "low" ? a.priceNaira - b.priceNaira : b.priceNaira - a.priceNaira));
    return list;
  }, [gender, cat, sort]);

  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Opening Offishall Stores" />;
  const balance = gs?.balanceKobo ?? d.balanceKobo ?? "0";
  const item = sel ? itemById(sel) : null;

  /** After the server accepts a new outfit: the app, the game state, and every profile picture of this player all pick it up at once. */
  const applyOutfit = (res) => [
    { store, patch: (x) => ({ ...x, wear: res.wear, look: res.look, lookKey: res.lookKey }) },
    { store: game, patch: (s) => (s ? { ...s, character: { ...s.character, look: res.look } } : s) },
  ];
  const announce = (res) => {
    const name = game.get()?.character?.name;
    if (name) avatarDirectory.seed(name, res.gender ?? gender, res.look, res.lookKey);
    window.dispatchEvent(new Event("game:refresh"));
  };

  async function wear(ids, label) {
    const fit = checkWear(ids, gender);
    if (!fit.ok) return toast.error(fit.reason); // the server checks again; this only saves a trip
    setBusy(true);
    await run({ key: "wardrobe:equip", router, sensitive: true, pending: "Changing clothes…", ok: `You are now wearing ${label}.`, request: () => call("/api/wardrobe", { action: "equip", ids: fit.ids }), after: applyOutfit, then: announce });
    setBusy(false);
  }
  async function wearStarter() {
    setBusy(true);
    await run({ key: "wardrobe:equip", router, sensitive: true, pending: "Changing clothes…", ok: "You are back in your starter outfit.", request: () => call("/api/wardrobe", { action: "starter" }), after: applyOutfit, then: announce });
    setBusy(false);
  }
  async function buy(it) {
    if (!canAfford(BigInt(koboOf(it)))) return toast.error(`You need ${naira(koboOf(it))} to buy ${it.name}. You have ${naira(balance)}.`);
    if (!(await confirmAction({ title: `Buy ${it.name}?`, message: `${kindOf(it)} · ${finishOf(it)}. You pay ${naira(koboOf(it))} from your bank balance and it is yours for good, in your wardrobe.`, confirmLabel: `Pay ${naira(koboOf(it))}` }))) return;
    setBusy(true);
    await run({
      key: "wardrobe:buy:" + it.id, router, sensitive: true, pending: `Buying ${it.name}…`, ok: `${it.name} is in your wardrobe.`, sound: "coin",
      request: () => call("/api/wardrobe", { action: "buy", itemId: it.id, requestId: crypto.randomUUID() }),
      effects: [
        { store, patch: (x) => ({ ...x, owned: x.owned.some((o) => o.id === it.id) ? x.owned : [...x.owned, { id: it.id, paidKobo: koboOf(it), at: new Date().toISOString() }] }) },
        { store: game, patch: cash(-BigInt(koboOf(it))) },
      ],
    });
    setBusy(false);
  }

  // ---------- one item ----------
  if (item) {
    const own = owns(item.id), fits = fitsGender(item, gender), price = BigInt(koboOf(item)), short = BigInt(balance) < price;
    const showing = previewWith(item, ownedIds, worn, gender);
    const outfit = own ? outfitWith(item, ownedIds, worn, gender) : null;
    const needs = item.slot === "top" ? "trousers or a skirt" : "a shirt or top";
    return (
      <div className="of">
        <button type="button" className="of-back" onClick={() => setSel(null)}><Icon name="back" size={16} /> Back</button>
        <div className="of-stage"><CharacterViewer look={{ ...d.look, wear: showing }} gender={gender} label={`${item.name} on your character`} /></div>
        <p className="of-note">{item.slot === "set" ? "Shown as the complete outfit." : `Shown with ${names(showing.filter((i) => i !== item.id))}, so the outfit is complete.`}</p>
        <div className="of-head"><span className="of-tag" data-k={item.tier}>{item.tier === "elite" ? "Elite Collection" : CAT_LABEL[item.category]}</span><b>{item.name}</b><span>{STYLES[item.style]} · {kindOf(item)} · {finishOf(item)}</span></div>
        <div className="of-art"><GarmentArt parts={item.parts} label={item.name} /></div>
        <div className="of-buy">
          <div><b className="of-price">{naira(koboOf(item))}</b><small>Your bank balance: {naira(balance)}</small></div>
          {!fits ? <button type="button" disabled>Not for your body type</button>
            : own ? <button type="button" className="go" disabled={busy || !outfit || wearKey(outfit) === wornKey} onClick={() => wear(outfit, item.name)}>{wearKey(outfit ?? []) === wornKey && outfit ? "Wearing now" : "Wear now"}</button>
              : <button type="button" className="go" disabled={busy} onClick={() => buy(item)}>{short ? `Need ${naira((price - BigInt(balance)).toString())} more` : `Buy for ${naira(koboOf(item))}`}</button>}
        </div>
        {own && !outfit && <p className="of-note" role="note">You own this. To wear it you also need {needs}: pick one in the store or your wardrobe.</p>}
        {own && <p className="of-note">Owned. It stays in your wardrobe whatever you buy next.</p>}
      </div>
    );
  }

  // ---------- wardrobe ----------
  const ids = pick.set ? [pick.set] : pick.top || pick.bottom ? [pick.top, pick.bottom].filter(Boolean) : null;
  const fit = ids ? checkWear(ids, gender) : null;
  const shownWear = fit?.ok ? fit.ids : worn; // never a half outfit: an incomplete pick keeps showing what is really worn
  const dirty = fit?.ok && wearKey(fit.ids) !== wornKey;
  const sections = [["Complete outfits", mine.filter((i) => i.slot === "set"), "set"], ["Tops", mine.filter((i) => i.slot === "top"), "top"], ["Bottoms", mine.filter((i) => i.slot === "bottom"), "bottom"]];
  const choose = (it) => setPick((p) => (it.slot === "set" ? { set: p.set === it.id ? null : it.id, top: null, bottom: null } : { set: null, top: it.slot === "top" ? (p.top === it.id ? null : it.id) : p.top, bottom: it.slot === "bottom" ? (p.bottom === it.id ? null : it.id) : p.bottom }));
  const isPicked = (it) => pick.set === it.id || pick.top === it.id || pick.bottom === it.id;
  const hidden = ownedIds.length - mine.length;

  return (
    <div className="of">
      <div className="of-hero"><span className="of-logo" aria-hidden="true">O</span><div><b>Offishall Store</b><span>Fashion for campus, the street and the red carpet</span></div><div className="of-bal"><small>Balance</small><b>{naira(balance)}</b></div></div>
      <div className="of-tabs" role="tablist" aria-label="Offishall sections">
        <button type="button" role="tab" aria-selected={tab === "store"} onClick={() => setTab("store")}>Store</button>
        <button type="button" role="tab" aria-selected={tab === "wardrobe"} onClick={() => setTab("wardrobe")}>Wardrobe{ownedIds.length ? ` (${ownedIds.length})` : ""}</button>
      </div>

      {tab === "store" && (<>
        <div className="of-chips" role="group" aria-label="Category">
          {[{ id: "all", label: "All" }, ...CATEGORIES.filter((c) => c.id !== "skirts" || gender === "F")].map((c) => <button key={c.id} type="button" aria-pressed={cat === c.id} data-elite={c.id === "elite" ? "1" : undefined} onClick={() => setCat(c.id)}>{c.label}</button>)}
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        {cat === "elite" && <p className="of-note">The Elite Collection: designer-style pieces and complete outfits.</p>}
        <div className="of-grid">
          {shelf.map((it) => (
            <button key={it.id} type="button" className="of-card" data-elite={it.tier === "elite" ? "1" : undefined} onClick={() => setSel(it.id)} aria-label={`${it.name}, ${naira(koboOf(it))}${owns(it.id) ? ", owned" : ""}`}>
              <span className="of-thumb"><GarmentArt parts={it.parts} />{owns(it.id) && <i className="of-own">Owned</i>}{it.slot === "set" && <i className="of-set">Outfit</i>}</span>
              <b>{it.name}</b><small>{STYLES[it.style]} · {kindOf(it)}</small><span className="of-p">{naira(koboOf(it))}</span>
            </button>
          ))}
        </div>
        {!shelf.length && <p className="of-note">Nothing in this category for your look yet.</p>}
      </>)}

      {tab === "wardrobe" && (ownedIds.length === 0 ? (
        <div className="of-empty"><Icon name="shirt" size={40} weight="duotone" /><h3>Your wardrobe is empty</h3><p>Clothes you buy at Offishall Store are kept here for good. {worn ? "" : "Until then you are wearing your starter outfit."}</p><button type="button" className="go" onClick={() => setTab("store")}>Visit Offishall Store</button></div>
      ) : (<>
        <div className="of-stage"><CharacterViewer look={{ ...d.look, wear: shownWear }} gender={gender} label="Your character" /></div>
        <p className="of-note">{shownWear ? <>Showing: {names(shownWear)}</> : "Showing: your starter outfit"}{worn ? <> · Wearing: {names(worn)}</> : " · Wearing: your starter outfit"}</p>
        {fit && !fit.ok && <p className="of-warn" role="status">{fit.reason}</p>}
        <div className="of-actions">
          <button type="button" className="go" disabled={busy || !dirty} onClick={() => wear(fit.ids, names(fit.ids))}>Wear this outfit</button>
          <button type="button" disabled={busy || !worn} onClick={wearStarter}>Starter outfit</button>
        </div>
        {sections.map(([title, list, slot]) => list.length > 0 && (
          <section key={slot} className="of-sec"><h3>{title}</h3>
            <div className="of-grid of-small">
              {list.map((it) => (
                <button key={it.id} type="button" className="of-card" aria-pressed={isPicked(it)} data-elite={it.tier === "elite" ? "1" : undefined} onClick={() => choose(it)}>
                  <span className="of-thumb"><GarmentArt parts={it.parts} />{(worn ?? []).includes(it.id) && <i className="of-own">Wearing</i>}</span><b>{it.name}</b><small>{STYLES[it.style]}</small>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!mine.length && <p className="of-note">None of your clothes fit your current look. Visit the store to get some.</p>}
        {!mine.some((i) => i.slot === "set") && (!mine.some((i) => i.slot === "top") || !mine.some((i) => i.slot === "bottom")) && mine.length > 0 && <p className="of-note">To dress in your own clothes you need a top and a bottom, or a complete outfit.</p>}
        {hidden > 0 && <p className="of-note">{hidden} item{hidden === 1 ? "" : "s"} made for a different look stay safely in your wardrobe.</p>}
        <button type="button" onClick={() => setTab("store")}>Shop for more</button>
      </>))}
    </div>
  );
}