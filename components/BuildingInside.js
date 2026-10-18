// components/BuildingInside.js
// Where you are once you have gone through a building's door: a 3D interior you can walk around (lib3d/interiors), with the real players who are
// inside right now and the same actions the map card offers. The 3D code is loaded only when you go in and freed when you step outside.
// If the browser cannot start WebGL, the old card (place, people, actions) is shown instead, so nothing is lost.
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { Stick, Hold } from "./TripHud";
import { call } from "@/lib/client";
import ActivityLayer from "./ActivityLayer";
import { ICON_OF } from "@/lib3d/landmarks.js";
import "./travel.css";

export default function BuildingInside({ place, look = null, gender = "M", onLeave }) {
  const [people, setPeople] = useState(null), [status, setStatus] = useState("loading"), [info, setInfo] = useState(false), [room, setRoom] = useState(""), [near, setNear] = useState(null), [view, setView] = useState("follow"), [note, setNote] = useState(""), [rings, setRings] = useState([]), [open, setOpen] = useState(null);
  const box = useRef(null), api = useRef(null), [input] = useState(() => ({ jx: 0, jy: 0, run: false, hold(v) { this.run = v; } })), router = useRouter(), leave = useRef(onLeave);
  useEffect(() => { leave.current = onLeave; });
  useEffect(() => {
    let on = true; const load = async () => { const r = await call("/api/travel?at=" + encodeURIComponent(place.id)); if (on && !r.failed) setPeople(r.people ?? []); };
    load(); const t = setInterval(() => !document.hidden && load(), 12000); return () => { on = false; clearInterval(t); };
  }, [place.id]);
  useEffect(() => { // the 3D interior: built when you arrive, freed when you leave
    let dead = false, scene = null;
    (async () => {
      try {
        const [{ buildInterior, classify, PLAN_NOTE }, { createInteriorScene }, { activityHubs }] = await Promise.all([import("@/lib3d/interiors/index.js"), import("@/lib3d/interiors/scene.js"), import("@/lib3d/interiors/activityHubs.js")]);
        const c = buildInterior(place); if (!c) { setStatus("none"); return; } setNote(PLAN_NOTE);
        // the activity rings: placed by the same code the server uses to check where you stand (lib3d/interiors/activityHubs.js), drawn teal
        const list = activityHubs(c, classify(place.id, place.kind).spec).hubs.map((h) => ({ ...h, activity: h.id, tint: "#5fe3c0" })); c.hubs = [...c.hubs, ...list]; setRings(list); if (dead || !box.current) return;
        scene = await createInteriorScene(box.current, c, { look, gender, input, view: "follow", onExit: () => leave.current?.(), onRoom: setRoom, onNear: setNear, onHub: (h) => { if (h.activity) { setOpen(h); return; } const a = place.actions?.[h.action]; if (a?.href) router.push(a.href); else setInfo(true); } });
        if (dead) { scene.dispose(); return; } api.current = scene; setStatus("ready");
      } catch (e) { console.warn("interior unavailable", e); if (!dead) setStatus("fallback"); }
    })();
    return () => { dead = true; api.current = null; scene?.dispose(); };
  }, [place.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !(near && near.activity === open.activity)) setOpen(null); }, [near, open]); // walking away from a ring closes its panel
  useEffect(() => { const k = (e) => { if (e.key !== "Escape") return; if (open) setOpen(null); else if (info) setInfo(false); else onLeave(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onLeave, info, open]);

  const card = (
    <div className="bi" role="dialog" aria-modal="true" aria-label={`About ${place.name}`} data-over={status === "ready" ? "1" : undefined} onClick={(e) => { if (status === "ready" && e.target === e.currentTarget) setInfo(false); }}>
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
        {status === "ready" && note && <p className="mut bi-soon">{note}</p>}
        {status === "fallback" && <p className="mut bi-soon">The 3D rooms could not start on this device, so you are seeing the lobby card instead.</p>}
        {status === "none" && <p className="mut bi-soon">This is an open-air place, so there are no rooms to walk through.</p>}
        <button type="button" className="go" onClick={() => (status === "ready" ? setInfo(false) : onLeave())}><Icon name={status === "ready" ? "back" : "door"} size={18} /> {status === "ready" ? "Back to walking" : "Step outside"}</button>
      </div>
    </div>
  );
  if (status === "fallback" || status === "none") return card;
  return (
    <div className="bi3" role="dialog" aria-modal="true" aria-label={`Inside ${place.name}`}>
      <div className="bi3-view" ref={box} />
      {status === "loading" && <div className="bi3-load" role="status"><Icon name="door" size={30} /><b>Going in…</b></div>}
      {status === "ready" && (
        <div className="th bi3-hud">
          <div className="bi3-top">
            <button type="button" className="bi3-btn" onClick={onLeave} data-sound="none"><Icon name="door" size={18} /> Exit</button>
            <div className="bi3-title"><b>{place.name}</b><span>{room}</span></div>
            <button type="button" className="bi3-btn" aria-label="Switch between close view and top view" onClick={() => setView(api.current?.toggleView() ?? "follow")} data-sound="none"><Icon name={view === "follow" ? "eye" : "focus"} size={18} /></button>
            <button type="button" className="bi3-btn" aria-label="About this place" onClick={() => setInfo(true)} data-sound="none"><Icon name="users" size={18} /></button>
          </div>
          {near && !open && <button type="button" className={`bi3-use${near.activity ? " act" : ""}`} onClick={() => api.current?.use()} data-sound="none"><Icon name={near.activity ? "timer" : "sparkle"} size={18} weight="fill" /> {near.label} <kbd>F</kbd></button>}
          <ActivityLayer api={api} rings={rings} open={open} ready onClose={() => setOpen(null)} onLeave={onLeave} />
          <p className="bi3-help">Walk with WASD or the stick · Shift to run · drag to look · V changes view · walk out of the door to leave</p>
          <Stick input={input} />
          <Hold className="th-btn th-run" label="Run" onDown={() => input.hold(true)} onUp={() => input.hold(false)}>RUN</Hold>
        </div>
      )}
      {info && card}
    </div>
  );
}