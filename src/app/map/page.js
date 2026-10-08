// app/map/page.js
"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { LANDMARKS } from "@/lib3d/landmarks.js";
import { Icon, KIND_ICON } from "@/components/Icon";

const CampusMap = dynamic(() => import("@/components/CampusMap"), { ssr: false });
const GROUPS = [["Campus core", ["hall", "library", "statue", "social"]], ["Faculties", ["faculty", "hospital", "farm"]], ["Hostels", ["hostel"]], ["Town and gate", ["gate", "town"]], ["Nightlife", ["club"]]];
const KIND_LABEL = { hall: "Hall", library: "Library", faculty: "Faculty", hospital: "Health sciences", farm: "Farm", hostel: "Hostel", social: "Student life", statue: "Landmark", gate: "Gate", club: "Nightlife", town: "Town" };

export default function MapPage() {
  const [sel, setSel] = useState(null), [list, setList] = useState(false), L = LANDMARKS.find((l) => l.id === sel);
  useEffect(() => { if (!list) return; const k = (e) => e.key === "Escape" && setList(false); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [list]);
  return (<>
    <div className="mapwrap"><CampusMap selectedId={sel} onSelect={setSel} /></div>
    <div style={{ position: "fixed", zIndex: 20, left: 10, top: "calc(var(--safe-t) + 74px)" }}>
      <button type="button" onClick={() => setList(true)} style={{ background: "rgba(13,19,33,0.88)" }}><Icon name="list" /> Places</button>
    </div>
    {L && (<div className="dock"><div className="card" role="region" aria-label={L.name}>
      <div className="top"><h2>{L.name}</h2><button type="button" className="ghost" aria-label="Close details" onClick={() => setSel(null)}><Icon name="close" /></button></div>
      <p className="mut"><Icon name={KIND_ICON[L.kind]} size={16} /> {KIND_LABEL[L.kind]}{L.verified ? " · a real OAU landmark" : " · placement is schematic"}</p>
      <p>{L.blurb}</p>
      {L.actions.length > 0 && <div className="row">{L.actions.map((a) => <Link key={a.href} href={a.href} className="btn go">{a.label}</Link>)}</div>}
    </div></div>)}
    {list && (<div className="sheet-scrim" onClick={() => setList(false)}><div className="sheet" role="dialog" aria-modal="true" aria-label="Places" onClick={(e) => e.stopPropagation()}>
      <div className="top"><h2>Places</h2><button type="button" className="ghost" aria-label="Close list" onClick={() => setList(false)}><Icon name="close" /></button></div>
      <p className="mut">The map is stylised and not to scale. Names marked as real OAU landmarks were checked; the rest are game placements.</p>
      {GROUPS.map(([title, kinds]) => (<div key={title}><h3 style={{ marginTop: 16 }}>{title}</h3>
        {LANDMARKS.filter((l) => kinds.includes(l.kind)).map((l) => (<button key={l.id} type="button" className="ghost" style={{ width: "100%", justifyContent: "flex-start", marginTop: 6 }} onClick={() => { setSel(l.id); setList(false); }}><Icon name={KIND_ICON[l.kind]} />{l.name}</button>))}</div>))}
    </div></div>)}
  </>);
}
