// components/ClubPanel.js
// The club menu you open inside 0203, Royal Divas or Quantum: luxury bottles (for yourself or a friend in the club), money spraying, bottle-service packages,
// other experiences and club buyouts. It only SHOWS the price list (lib/clubs.js, the same file the server charges from) and ASKS the server to sell; the show on the
// floor starts only after the server says the purchase went through (see ClubLayer.js). A price typed or tampered with here changes nothing: the server decides.
"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { call, naira } from "@/lib/client";
import { game, useGame, run, cash } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { DRINKS, PACKAGES, EXPERIENCES, BUYOUT_TIERS, BUYOUT_TERMS, SPRAY_AMOUNTS, VIP_PERKS, MIN_SPEND, MAX_SPEND, SPEND_STEP, validSpend, tierOf, fxLevel, buyoutPrice, drinkById } from "@/lib/clubs.js";
import "./club.css";

const N = (n) => "₦" + Number(n).toLocaleString("en-NG");
const CONFIRM_FROM = 100_000; // anything from here up (and every gift and buyout) asks "are you sure?" first
const TABS = [["bottles", "Bottles", "gift"], ["spray", "Spray", "coins"], ["packages", "Packages", "forbes"], ["more", "Experiences", "sparkle"], ["buyout", "Buyout", "club"]];

/** One bottle drawn for each drink: its own shape and colours (original artwork, not a maker's label). */
export function BottleArt({ drink, size = 84 }) {
  const { shape, body, label, cap, metal } = drink, glow = drink.exclusive ? "#ffd24a" : null;
  const paths = {
    cognac: "M22 34 h16 v10 c8 6 14 14 14 30 v34 a6 6 0 0 1 -6 6 h-32 a6 6 0 0 1 -6 -6 v-34 c0 -16 6 -24 14 -30 z",
    squat: "M23 40 h14 v8 c10 4 17 11 17 24 v36 a6 6 0 0 1 -6 6 h-36 a6 6 0 0 1 -6 -6 v-36 c0 -13 7 -20 17 -24 z",
    champagne: "M26 12 h8 v28 c0 12 10 18 10 34 v40 a6 6 0 0 1 -6 6 h-26 a6 6 0 0 1 -6 -6 v-40 c0 -16 10 -22 10 -34 z",
    ceramic: "M24 30 h12 v12 c14 6 22 18 22 36 c0 20 -10 32 -28 32 c-18 0 -28 -12 -28 -32 c0 -18 8 -30 22 -36 z",
    decanter: "M20 26 h20 v14 c0 8 -6 10 -6 14 c14 4 24 14 24 34 v18 a6 6 0 0 1 -6 6 h-44 a6 6 0 0 1 -6 -6 v-18 c0 -20 10 -30 24 -34 c0 -4 -6 -6 -6 -14 z",
  };
  const ly = { cognac: 78, squat: 78, champagne: 78, ceramic: 70, decanter: 84 }[shape] ?? 78;
  return (
    <svg className="cl-bottle" width={size} height={size * 1.4} viewBox="0 0 60 120" role="img" aria-label={`${drink.name} bottle`}>
      {glow && <ellipse cx="30" cy="112" rx="26" ry="5" fill={glow} opacity="0.35" />}
      <path d={paths[shape] ?? paths.cognac} fill={body} stroke={metal ? "#fff2b0" : "rgba(255,255,255,0.35)"} strokeWidth="1.4" />
      <rect x="13" y={ly - 9} width="34" height="18" rx="2" fill={label} opacity="0.95" />
      <rect x="21" y={ly - 3} width="18" height="3" fill={body} opacity="0.55" />
      <rect x={shape === "champagne" ? 25 : shape === "ceramic" ? 23 : 21} y={shape === "champagne" ? 6 : shape === "ceramic" ? 24 : shape === "decanter" ? 20 : 28} width={shape === "champagne" ? 10 : shape === "ceramic" ? 14 : 18} height="7" rx="2" fill={cap} stroke="rgba(0,0,0,0.25)" />
      {metal && <path d="M30 70 l7 9 -7 9 -7 -9 z" fill="#15151a" />}
    </svg>
  );
}

export default function ClubPanel({ club, state, people = [], selfName = "", onClose, onBought }) {
  const [tab, setTab] = useState("bottles"), [pick, setPick] = useState(null), [busy, setBusy] = useState(false), [custom, setCustom] = useState(""), [amount, setAmount] = useState(SPRAY_AMOUNTS[2]), [to, setTo] = useState(null);
  const g = useGame(), router = useRouter(), rid = useRef(null);
  const open = !!state?.status?.open, balance = g?.balanceKobo != null ? BigInt(g.balanceKobo) : null, can = (n) => balance == null || balance >= BigInt(n) * 100n;
  const friends = people.filter((p) => p.name && p.name.toLowerCase() !== selfName.toLowerCase());
  const buyout = state?.buyout, vip = state?.vip;

  /** Ask for a purchase. `p`: { kind, itemId, amount?, to?, naira, label }. Nothing is shown as bought until the server says so. */
  async function pay(p) {
    if (busy) return; setBusy(true); rid.current ??= crypto.randomUUID(); // the same id is kept while the answer is unknown, so a retry can never charge twice
    const res = await run({ key: "club:buy", router, sensitive: true, pending: `Paying for ${p.label}…`, ok: `${p.label}: paid.`, sound: "coin",
      request: () => call("/api/club", { kind: p.kind, itemId: p.itemId, amount: p.amount, to: p.to, requestId: rid.current }),
      effects: [{ store: game, patch: cash(-BigInt(p.naira) * 100n) }] });
    if (!res.unknown) rid.current = null; // a clear answer (yes or no): the next purchase is a new request
    if (!res.failed && !res.skipped) { setPick(null); game.refresh(); onBought?.(res); } else if (res.skipped) { /* a tap on a purchase already running */ }
    setBusy(false);
  }
  /** Ask first for anything big, a gift or a buyout; buy straight away for small things. */
  const ask = (p) => { if (!open) return toast.error(`${club.name} is closed. Open ${state?.status?.hours ?? "8 PM – 5 AM"}.`); if (!can(p.naira)) return toast.error(`You need ${N(p.naira)} for that.`); if (p.naira >= CONFIRM_FROM || p.kind === "GIFT_DRINK" || p.kind === "BUYOUT") setPick(p); else pay(p); };
  const bottleFor = (d) => ({ kind: to ? "GIFT_DRINK" : "DRINK", itemId: d.id, to: to ?? undefined, naira: d.priceNaira, label: to ? `${d.name} for ${to}` : d.name, note: to ? `${to} gets the bottle and your name on the announcement. You pay the full price; they pay nothing.` : "A waiter brings it to your spot and the club sees it.", art: d });

  const customN = Number(String(custom).replace(/[^\d]/g, "")), customOk = custom !== "" && validSpend(customN), chosen = custom !== "" ? (customOk ? customN : null) : amount;
  const sprayLevel = chosen ? fxLevel(chosen) : 0;

  return (
    <div className="cl-scrim" role="dialog" aria-modal="true" aria-label={`${club.name} club menu`} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="cl" style={{ "--neon": club.neon }}>
        <header className="cl-head">
          <div><small>{club.name}</small><h2>Club menu</h2></div>
          <div className="cl-bal" aria-live="polite"><small>Your cash</small><b>{balance == null ? "…" : naira(balance)}</b></div>
          <button type="button" className="cl-x" onClick={onClose} disabled={busy} aria-label="Close the club menu"><Icon name="close" size={20} /></button>
        </header>
        {!open && <p className="cl-closed" role="status"><Icon name="lock" size={16} /> {club.name} is closed. It opens {state?.status?.hours ?? "8 PM – 5 AM"} (game time). Purchases are switched off.</p>}
        {open && (vip || buyout) && <p className="cl-vipbar" role="status"><Icon name="sparkle" size={16} weight="fill" /> {buyout ? `${buyout.host} has the club: the bar is on them.` : "You have VIP: no ticket, free bar."}</p>}
        <nav className="cl-tabs" aria-label="Sections">{TABS.map(([id, name, icon]) => <button key={id} type="button" className="cl-tab" aria-pressed={tab === id} onClick={() => setTab(id)}><Icon name={icon} size={16} /> {name}</button>)}</nav>

        <div className="cl-body">
          {tab === "bottles" && (<>
            <div className="cl-for" role="group" aria-label="Who is the drink for?">
              <button type="button" aria-pressed={!to} onClick={() => setTo(null)}>For me</button>
              <button type="button" aria-pressed={!!to} onClick={() => setTo(friends[0]?.name ?? null)} disabled={friends.length === 0}>For a friend</button>
              {to && <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Who gets the drink">{friends.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}</select>}
              {friends.length === 0 && <small>Nobody else is inside right now.</small>}
            </div>
            <div className="cl-grid">
              {DRINKS.map((d) => (
                <article key={d.id} className={`cl-card${d.exclusive ? " ex" : ""}`}>
                  {d.exclusive && <span className="cl-tag">EXCLUSIVE</span>}
                  <BottleArt drink={d} />
                  <h3>{d.name}</h3><small>{d.kind}</small>
                  <p>{d.blurb}</p>
                  <b className="cl-price">{N(d.priceNaira)}</b>
                  <button type="button" className="cl-buy" disabled={busy || !open || !can(d.priceNaira)} onClick={() => ask(bottleFor(d))}>{!can(d.priceNaira) ? "Not enough cash" : to ? `Send to ${to}` : "Order"}</button>
                </article>
              ))}
            </div>
          </>)}

          {tab === "spray" && (<section className="cl-spray">
            <p className="cl-lead">Make it rain. Notes fly from your hands and fall around you for everyone to see; the more you spray, the bigger the show.</p>
            <div className="cl-chips" role="group" aria-label="Amount to spray">{SPRAY_AMOUNTS.map((a) => <button key={a} type="button" aria-pressed={custom === "" && amount === a} onClick={() => { setCustom(""); setAmount(a); }}>{N(a)}</button>)}</div>
            <label className="cl-custom">Or type an amount <input inputMode="numeric" placeholder={`${N(MIN_SPEND)} to ${N(MAX_SPEND)}`} value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d,]/g, ""))} aria-invalid={custom !== "" && !customOk} /></label>
            {custom !== "" && !customOk && <small className="cl-bad">Between {N(MIN_SPEND)} and {N(MAX_SPEND)}, in steps of {N(SPEND_STEP)}.</small>}
            {chosen && <p className="cl-lvl">Show size: {"●".repeat(sprayLevel)}{"○".repeat(5 - sprayLevel)} · {tierOf(chosen).label}</p>}
            <button type="button" className="cl-buy big" disabled={busy || !open || !chosen || !can(chosen ?? 0)} onClick={() => chosen && ask({ kind: "SPRAY", amount: chosen, itemId: "spray", naira: chosen, label: `Spray ${N(chosen)}`, note: "The money is gone the moment you spray it. Your arms go up and everyone sees your name and the amount." })}>{chosen ? (can(chosen) ? `Spray ${N(chosen)}` : "Not enough cash") : "Pick an amount"}</button>
          </section>)}

          {tab === "packages" && (<>
            <p className="cl-lead">Bottle service with a table. <b>What VIP means here:</b> {VIP_PERKS.join(" · ")}.</p>
            <div className="cl-grid">
              {PACKAGES.map((p) => <article key={p.id} className="cl-card ex"><BottleArt drink={drinkById(p.bottle)} /><h3>{p.name}</h3><ul className="cl-list">{p.benefits.map((b) => <li key={b}>{b}</li>)}</ul><b className="cl-price">{N(p.priceNaira)}</b>
                <button type="button" className="cl-buy" disabled={busy || !open || !can(p.priceNaira)} onClick={() => ask({ kind: "PACKAGE", itemId: p.id, naira: p.priceNaira, label: p.name, note: p.benefits.join(". ") + "." })}>{can(p.priceNaira) ? "Get this package" : "Not enough cash"}</button></article>)}
            </div>
          </>)}

          {tab === "more" && (<div className="cl-rows">{EXPERIENCES.map((x) => (
            <article key={x.id} className="cl-row"><span className="cl-ico"><Icon name={x.icon} size={20} /></span><div><h3>{x.name}</h3><p>{x.summary}</p><small>{x.effect}</small></div><div className="cl-end"><b className="cl-price">{N(x.priceNaira)}</b>
              <button type="button" className="cl-buy" disabled={busy || !open || !can(x.priceNaira)} onClick={() => ask({ kind: "EXPERIENCE", itemId: x.id, naira: x.priceNaira, label: x.name, note: x.effect })}>{can(x.priceNaira) ? "Buy" : "Not enough cash"}</button></div></article>))}</div>)}

          {tab === "buyout" && (<section>
            {buyout ? <p className="cl-closed" role="status"><Icon name="timer" size={16} /> {buyout.host} has {club.name} ({buyout.name}) until the timer on your screen runs out. Only one buyout can run at a time.</p> : <p className="cl-lead">Take over {club.name} for a few minutes. Read what you get before you pay:</p>}
            <ul className="cl-list terms">{BUYOUT_TERMS.map((t) => <li key={t}>{t}</li>)}</ul>
            <div className="cl-grid">{BUYOUT_TIERS.map((t) => { const price = buyoutPrice(club.id, t.id); return (
              <article key={t.id} className="cl-card ex"><h3>{t.name}</h3><p>{t.summary}</p><small>{t.minutes} minutes</small><b className="cl-price">{N(price)}</b>
                <button type="button" className="cl-buy" disabled={busy || !open || !!buyout || !can(price)} onClick={() => ask({ kind: "BUYOUT", itemId: t.id, naira: price, label: `${t.name} at ${club.name}`, note: `${t.summary} ${BUYOUT_TERMS.join(" ")}` })}>{buyout ? "Someone has the club" : can(price) ? "Buy out the club" : "Not enough cash"}</button></article>); })}</div>
          </section>)}
        </div>

        {pick && (
          <div className="cl-confirm" role="alertdialog" aria-modal="true" aria-label="Confirm purchase">
            <div className="cl-sheet">
              {pick.art && <BottleArt drink={pick.art} size={64} />}
              <small>Confirm purchase at {club.name}</small>
              <h3>{pick.label}</h3>
              <b className="cl-price big">{N(pick.naira)}</b>
              {pick.to && <p className="cl-to">For <b>{pick.to}</b>. They will be told it is from you.</p>}
              <p>{pick.note}</p>
              <p className="cl-after">Your cash after: {balance == null ? "…" : naira(balance - BigInt(pick.naira) * 100n)}</p>
              <div className="cl-btns"><button type="button" className="cl-cancel" onClick={() => setPick(null)} disabled={busy}>Cancel</button><button type="button" className="cl-buy" onClick={() => pay(pick)} disabled={busy}>{busy ? "Paying…" : `Pay ${N(pick.naira)}`}</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}