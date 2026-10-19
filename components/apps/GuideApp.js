// components/apps/GuideApp.js: OAU Guide. Lives inside the phone (see components/Phone.js).
// Everything shown here comes from the feature registry (lib/features.js) and the map data, so a new activity, building or app that is
// registered there appears here by itself. Buttons reuse what already exists: "Go to location" opens the map on that place,
// "Open app" opens the phone app, "Show me how" unfolds the steps. Nothing is started from here: the game's own screens do that,
// and the server still decides every reward and rule.
"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import { useGame } from "@/lib/gameStore";
import { serverTime } from "@/lib/serverClock";
import { loadCampusData, listPlaces } from "@/lib3d/campusData.js";
import { ICON_OF, KIND_LABEL, MAP_GROUPS } from "@/lib3d/landmarks.js";
import { CATEGORIES, OTHER_GROUPS, allFeatures, isOffered, statusLabel, activitiesAt, featuresAt } from "@/lib/features.js";
import "./guide-app.css";

const CERTAIN = { guaranteed: ["Sure thing", "You always get this."], variable: ["Not guaranteed", "The amount or the result changes each time, or you can lose."] };
const norm = (s) => String(s ?? "").toLowerCase();

/** Open the map on a place (and, optionally, the activity to do there). The map page reads this and opens that place's panel. */
function useGoTo(onClose) {
  const router = useRouter();
  return (to, act) => {
    onClose?.();
    if (typeof window !== "undefined" && window.location.pathname === "/map") window.dispatchEvent(new CustomEvent("oau:goto", { detail: { to, act } }));
    else router.push(`/map?to=${encodeURIComponent(to)}${act ? `&do=${encodeURIComponent(act)}` : ""}`);
  };
}

function Facts({ title, items, tone }) {
  if (!items?.length) return null;
  return (
    <div className="gd-facts" data-tone={tone}>
      <b>{title}</b>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

function FeatureCard({ f, names, held, goTo, openApp }) {
  const [open, setOpen] = useState(false);
  const offered = isOffered(f), place = f.place && names.get(f.place), where = place?.name ?? f.place;
  const cert = f.certainty && CERTAIN[f.certainty], isAct = !!f.derived;
  const travelWhy = held ? "You are held in Floor O. You cannot travel until your sentence ends." : null;
  return (
    <article className="gd-card" data-risk={f.risk} data-status={f.status}>
      <header>
        <h3>{f.name}</h3>
        <span className="gd-tags">
          {f.risk === "risky" && <i className="gd-tag" data-k="risky">Risky</i>}
          {f.earns === "legit" && <i className="gd-tag" data-k="legit">Legit</i>}
          {cert && <i className="gd-tag" data-k={f.certainty} title={cert[1]}>{cert[0]}</i>}
          {f.status !== "live" && <i className="gd-tag" data-k="partial">{statusLabel(f.status)}</i>}
        </span>
      </header>
      <p>{f.summary}</p>
      {f.status !== "live" && f.note && <p className="gd-note"><Icon name="warn" size={14} /> {f.note}</p>}
      {where && <p className="gd-where"><Icon name="pin" size={14} weight="fill" /> {where}{f.places?.length > 1 ? ` and ${f.places.length - 1} more` : ""}</p>}
      <Facts title="What you need" items={f.needs} />
      <Facts title="What you get" items={f.gives} tone="good" />
      <Facts title="What it costs or risks" items={f.costs} tone={f.risk === "risky" ? "bad" : undefined} />
      {open && f.steps.length > 0 && <ol className="gd-steps">{f.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>}
      <div className="gd-btns">
        {f.place && offered && <button type="button" className="go" disabled={!!travelWhy} title={travelWhy ?? undefined} onClick={() => goTo(f.place, isAct ? f.id.slice("activity.".length) : null)}><Icon name={isAct ? "timer" : "nav"} size={16} weight="fill" /> {isAct ? "Start activity" : "Go to location"}</button>}
        {f.app && offered && f.app !== "guide" && <button type="button" onClick={() => openApp(f.app)}><Icon name="phone" size={16} /> Open app</button>}
        {f.steps.length > 0 && <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Icon name={open ? "up" : "down"} size={16} /> {open ? "Hide steps" : "Show me how"}</button>}
      </div>
      {travelWhy && f.place && <p className="gd-why">{travelWhy}</p>}
    </article>
  );
}

function PlaceRow({ p, held, goTo }) {
  const [open, setOpen] = useState(false);
  const acts = useMemo(() => activitiesAt(p.id, p.kind), [p.id, p.kind]), extra = useMemo(() => featuresAt(p.id, p.kind).extra, [p.id, p.kind]);
  const things = acts.length + extra.length;
  const why = !p.located ? "This place is not on the map yet." : held ? "You are held in Floor O. You cannot travel until your sentence ends." : null;
  return (
    <div className="gd-place" data-open={open ? "1" : undefined}>
      <button type="button" className="gd-prow" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="gd-pico"><Icon name={ICON_OF[p.kind] ?? "town"} size={20} /></span>
        <span className="gd-ptxt"><b>{p.name}</b><small>{KIND_LABEL[p.kind] ?? "Place"} · {things ? `${things} thing${things === 1 ? "" : "s"} to do` : "nothing to do inside"}</small></span>
        <Icon name={open ? "up" : "down"} size={16} />
      </button>
      {open && (
        <div className="gd-pbody">
          {p.blurb && <p>{p.blurb}</p>}
          {acts.length > 0 && <ul className="gd-acts">{acts.map((a) => (
            <li key={a.key} data-risk={a.risk}><b>{a.label}</b>{a.risk === "risky" && <i className="gd-tag" data-k="risky">Risky</i>}<small>{a.summary}</small></li>
          ))}</ul>}
          {extra.map((f) => <p key={f.id} className="gd-where"><Icon name="sparkle" size={14} /> {f.name}: {f.summary}</p>)}
          {p.actions?.length > 0 && <p className="mut">Also here: {p.actions.map((a) => a.label).join(", ")}.</p>}
          <div className="gd-btns"><button type="button" className="go" disabled={!!why} title={why ?? undefined} onClick={() => goTo(p.id)}><Icon name="nav" size={16} weight="fill" /> Go to location</button></div>
          {why && <p className="gd-why">{why}</p>}
        </div>
      )}
    </div>
  );
}

export default function GuideApp({ onOpenApp, onClose }) {
  const g = useGame(), held = !!g?.floorZero && +new Date(g.floorZero.releaseAt) > serverTime();
  const [cat, setCat] = useState("start"), [q, setQ] = useState(""), [places, setPlaces] = useState(null), [failed, setFailed] = useState(false);
  const goTo = useGoTo(onClose), openApp = (id) => onOpenApp?.(id);
  const features = useMemo(() => allFeatures(), []);
  useEffect(() => {
    let on = true;
    loadCampusData().then((d) => on && setPlaces(listPlaces(d))).catch(() => on && setFailed(true));
    return () => { on = false; };
  }, []);
  const names = useMemo(() => new Map((places ?? []).map((p) => [p.id, p])), [places]);

  const query = norm(q).trim();
  const fMatch = (f) => !query || norm([f.name, f.summary, f.needs.join(" "), f.gives.join(" "), f.steps.join(" "), names.get(f.place)?.name].join(" ")).includes(query);
  const pMatch = (p) => !query || norm(p.name).includes(query) || activitiesAt(p.id, p.kind).some((a) => norm(a.label).includes(query));
  const inCat = (id) => features.filter((f) => f.category === id).filter(fMatch);

  const sections = CATEGORIES.map((c) => c.id);
  const body = () => {
    if (query) {
      const fs = features.filter((f) => !(f.derived && f.group === "activities" && f.category === "other")).filter(fMatch), ps = (places ?? []).filter(pMatch).slice(0, 25);
      return (
        <>
          <p className="gd-count">{fs.length + ps.length} result{fs.length + ps.length === 1 ? "" : "s"} for “{q.trim()}”</p>
          {fs.map((f) => <FeatureCard key={f.id} f={f} names={names} held={held} goTo={goTo} openApp={openApp} />)}
          {ps.length > 0 && <><h3 className="gd-h">Places</h3>{ps.map((p) => <PlaceRow key={p.id} p={p} held={held} goTo={goTo} />)}</>}
          {fs.length + ps.length === 0 && <p className="mut gd-empty">Nothing found. Try a place name, an app name or words like “money”, “sleep” or “exam”.</p>}
        </>
      );
    }
    const meta = CATEGORIES.find((c) => c.id === cat);
    const intro = <p className="gd-intro">{meta.blurb}</p>;
    if (cat === "world") {
      if (failed) return <>{intro}<p className="mut gd-empty">The map data could not load. Check your connection and open the guide again.</p>{inCat("world").map((f) => <FeatureCard key={f.id} f={f} names={names} held={held} goTo={goTo} openApp={openApp} />)}</>;
      return (
        <>
          {intro}
          {inCat("world").map((f) => <FeatureCard key={f.id} f={f} names={names} held={held} goTo={goTo} openApp={openApp} />)}
          {!places ? <p className="mut gd-empty">Loading the places…</p> : MAP_GROUPS.map(([title, kinds]) => {
            const items = places.filter((p) => kinds.includes(p.kind));
            if (!items.length) return null;
            return <section key={title}><h3 className="gd-h">{title}</h3>{items.map((p) => <PlaceRow key={p.id} p={p} held={held} goTo={goTo} />)}</section>;
          })}
        </>
      );
    }
    if (cat === "other") {
      return (
        <>
          {intro}
          {OTHER_GROUPS.map((gr) => {
            const items = features.filter((f) => f.category === "other" && f.group === gr.id);
            return items.length ? <section key={gr.id}><h3 className="gd-h">{gr.title}</h3>{items.map((f) => <FeatureCard key={f.id} f={f} names={names} held={held} goTo={goTo} openApp={openApp} />)}</section> : null;
          })}
        </>
      );
    }
    const items = features.filter((f) => f.category === cat);
    return (
      <>
        {intro}
        {cat === "risky" && <p className="gd-alert" role="note"><Icon name="siren" size={18} /> Risky means the game can take something from you: cash, health, your place at school or your freedom. Read what it costs before you try.</p>}
        {cat === "legit" && <p className="gd-alert gd-alert--ok" role="note"><Icon name="check" size={18} /> “Not guaranteed” means the amount changes each time. “Sure thing” means you always get it.</p>}
        {items.map((f) => <FeatureCard key={f.id} f={f} names={names} held={held} goTo={goTo} openApp={openApp} />)}
      </>
    );
  };

  return (
    <div className="gd">
      <div className="gd-search">
        <Icon name="eye" size={16} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guide" aria-label="Search the guide" />
      </div>
      {!query && (
        <div className="gd-tabs" role="tablist" aria-label="Guide sections">
          {sections.map((id) => <button key={id} type="button" role="tab" aria-selected={cat === id} data-risk={id === "risky" ? "1" : undefined} onClick={() => setCat(id)}>{CATEGORIES.find((c) => c.id === id).title}</button>)}
        </div>
      )}
      {body()}
    </div>
  );
}
