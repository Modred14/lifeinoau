// src/app/map/page.js
"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ICON_OF, KIND_LABEL, MAP_GROUPS } from "@/lib3d/landmarks.js";
import { loadCampusData, listPlaces, trustNote } from "@/lib3d/campusData.js";
import { Icon } from "@/components/Icon";
import BillboardPanel from "@/components/BillboardPanel";
import { call } from "@/lib/client";

const CampusMap = dynamic(() => import("@/components/CampusMap"), { ssr: false });

export default function MapPage() {
  const [sel, setSel] = useState(null), [list, setList] = useState(false), [places, setPlaces] = useState([]), [q, setQ] = useState("");
  const [bb, setBb] = useState(null);
  const refreshBb = () => call("/api/billboards").then((r) => { if (!r.failed) setBb(r); });
  useEffect(() => { refreshBb(); const t = setInterval(refreshBb, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { let on = true; loadCampusData().then((d) => on && setPlaces(listPlaces(d))).catch(() => {}); return () => { on = false; }; }, []);
  useEffect(() => { if (!list) return; const k = (e) => e.key === "Escape" && setList(false); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [list]);
  const L = places.find((l) => l.id === sel), shown = useMemo(() => places.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [places, q]);
  return (<>
    <div className="mapwrap"><CampusMap selectedId={sel} onSelect={setSel} billboards={bb?.boards ?? null} /></div>
    <div style={{ position: "fixed", zIndex: 20, left: 10, top: "calc(var(--safe-t) + 74px)" }}>
      <button type="button" onClick={() => setList(true)} style={{ background: "rgba(13,19,33,0.88)" }}><Icon name="list" /> Places</button>
    </div>
    {L && (<div className="dock"><div className={"card" + (L.kind === "billboard" ? " bb" : "")} role="region" aria-label={L.name}>
      <div className="top"><h2>{L.name}</h2><button type="button" className="ghost" aria-label="Close details" onClick={() => setSel(null)}><Icon name="close" /></button></div>
      <p className="mut"><Icon name={ICON_OF[L.kind] ?? "town"} size={16} /> {KIND_LABEL[L.kind] ?? "Place"} · {trustNote(L)}</p>
      <p>{L.blurb}</p>
      {L.kind === "billboard" && <BillboardPanel board={Number(L.id.slice(3))} state={bb} onChanged={refreshBb} />}
      {L.actions?.length > 0 && <div className="row">{L.actions.map((a) => <Link key={a.href} href={a.href} className="btn go">{a.label}</Link>)}</div>}
    </div></div>)}
    {list && (<div className="sheet-scrim" onClick={() => setList(false)}><div className="sheet" role="dialog" aria-modal="true" aria-label="Places" onClick={(e) => e.stopPropagation()}>
      <div className="top"><h2>Places</h2><button type="button" className="ghost" aria-label="Close list" onClick={() => setList(false)}><Icon name="close" /></button></div>
      <p className="mut">Building outlines, roads and names come from the OpenStreetMap map of OAU. Heights are assumed (most OAU buildings are 5 to 8 m; the Senate Building is 24 m) and shown taller than life so you can read the map. Places marked approximate were placed from another map. Ojaja, Akintola Hall, the Postgraduate hall, Floor 0, the clubs and the billboards are game placements: no map shows where they really are.</p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a place" aria-label="Find a place" style={{ width: "100%", marginTop: 10 }} />
      {MAP_GROUPS.map(([title, kinds]) => { const items = shown.filter((l) => kinds.includes(l.kind)); if (!items.length) return null; return (<div key={title}><h3 style={{ marginTop: 16 }}>{title}</h3>
        {items.map((l) => (<button key={l.id} type="button" className="ghost" style={{ width: "100%", justifyContent: "flex-start", marginTop: 6 }} onClick={() => { setSel(l.id); setList(false); }}><Icon name={ICON_OF[l.kind] ?? "town"} />{l.name}{!l.located ? " (no map position yet)" : l.conf === "approximate" ? " (approx.)" : ""}</button>))}</div>); })}
    </div></div>)}
  </>);
}