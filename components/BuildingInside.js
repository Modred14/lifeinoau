// components/BuildingInside.js
// Where you are once you have gone through a building's door. The rooms themselves are the next piece of work; for now this shows the place,
// the real players who are inside right now, and what you can do here (the same actions the map card offers).
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { call } from "@/lib/client";
import { ICON_OF } from "@/lib3d/landmarks.js";
import "./travel.css";

export default function BuildingInside({ place, onLeave }) {
  const [people, setPeople] = useState(null);
  useEffect(() => {
    let on = true; const load = async () => { const r = await call("/api/travel?at=" + encodeURIComponent(place.id)); if (on && !r.failed) setPeople(r.people ?? []); };
    load(); const t = setInterval(() => !document.hidden && load(), 12000); return () => { on = false; clearInterval(t); };
  }, [place.id]);
  useEffect(() => { const k = (e) => e.key === "Escape" && onLeave(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onLeave]);
  return (
    <div className="bi" role="dialog" aria-modal="true" aria-label={`Inside ${place.name}`}>
      <div className="bi-card">
        <span className="bi-ico"><Icon name={ICON_OF[place.kind] ?? "town"} size={30} weight="fill" /></span>
        <small>You are inside</small>
        <h2>{place.name}</h2>
        <p>{place.blurb}</p>
        {place.actions?.length > 0 && <div className="bi-actions">{place.actions.map((a) => <Link key={a.href} href={a.href} className="btn go">{a.label}</Link>)}</div>}
        <h3><Icon name="users" size={18} /> Here now{people ? ` · ${people.length}` : ""}</h3>
        {people == null ? <p className="mut">Looking around…</p> : people.length === 0 ? <p className="mut">Nobody else is here right now.</p> : (
          <ul className="bi-people">{people.map((p) => <li key={p.name}><span className="bi-av" aria-hidden="true">{p.name[0]}</span><b>{p.name}</b><small>{p.faculty} · {p.level}L</small></li>)}</ul>
        )}
        <p className="mut bi-soon">The rooms inside are coming next.</p>
        <button type="button" className="go" onClick={onLeave}><Icon name="door" size={18} /> Step outside</button>
      </div>
    </div>
  );
}