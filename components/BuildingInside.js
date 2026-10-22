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
import { serverTime } from "@/lib/serverClock";
import { game, useGame } from "@/lib/gameStore";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import LectureFight, { ResultCard } from "./LectureFight";
import ActivityLayer from "./ActivityLayer";
import ClubLayer from "./ClubLayer";
import { isClub, clubStatus, HOURS_LABEL } from "@/lib/clubs.js";
import { ICON_OF } from "@/lib3d/landmarks.js";
import { cellsOf } from "@/lib/custodyCells.js";
import { CUSTODY_PLACE, CUSTODY_NAME, isJailed } from "@/lib/discipline";
import { bailFor } from "@/lib/engine";
import { naira } from "@/lib/client";
import { getPrefs } from "@/lib/prefs";
import { lookKey } from "@/lib/look.js";
import "./travel.css";

// In the custody building every cell is locked to anyone who is not a prisoner (the server refuses those positions too, lib/custodyCells.js).
const lockedOf = (c, place) => (place.id === "floor0" ? cellsOf(c) : null);

export default function BuildingInside({ place, look = null, gender = "M", focus = null, selfName = "", onLeave, onCustody = null, cell = null, banner = null }) {
  const [people, setPeople] = useState(null), [status, setStatus] = useState("loading"), [info, setInfo] = useState(false), [room, setRoom] = useState(""), [near, setNear] = useState(null), [view, setView] = useState(cell ? "overhead" : getPrefs().gameplay.interiorView), [note, setNote] = useState(""), [rings, setRings] = useState([]), [open, setOpen] = useState(null);
  // the lecturers who teach in this building, the confrontation in progress, and the N-QRS response being acted out (all decided by the server: /api/lecture)
  const [fight, setFight] = useState(null), [incident, setIncident] = useState(null), [after, setAfter] = useState(null), [fade, setFade] = useState(0), lec = useRef({ courses: [] }), played = useRef(null);
  const [sceneReady, setSceneReady] = useState(false), confrontRef = useRef(null);
  const box = useRef(null), api = useRef(null), [input] = useState(() => ({ jx: 0, jy: 0, run: false, hold(v) { this.run = v; } })), router = useRouter(), leave = useRef(onLeave);
  useEffect(() => { leave.current = onLeave; });
  const peopleRef = useRef(null), selfRef = useRef(selfName); selfRef.current = selfName;
  // who else is in here: the list, and (for those who have reported where they stand) their avatars and name tags in the 3D room. Asked every few seconds,
  // and at once when the tab comes back, so someone who left or disconnected drops out of the room within moments.
  useEffect(() => {
    let on = true; const load = async () => {
      const r = await call("/api/travel?at=" + encodeURIComponent(place.id)); if (!on || r.failed) return;
      const list = (r.people ?? []).filter((p) => p.name.toLowerCase() !== String(selfRef.current).toLowerCase()); // you are never in your own list
      peopleRef.current = list; setPeople(list); api.current?.setRemotePlayers(list);
    };
    load(); const t = setInterval(() => !document.hidden && load(), 4000), v = () => !document.hidden && load(); document.addEventListener("visibilitychange", v);
    return () => { on = false; clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [place.id]);
  // stepping out (door, button, Escape, closing the tab): tell the server at once, so nobody keeps seeing you inside
  useEffect(() => {
    const bye = () => fetch("/api/travel", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "leave" }) }).catch(() => {});
    window.addEventListener("pagehide", bye); return () => { window.removeEventListener("pagehide", bye); bye(); };
  }, [place.id]);
  useEffect(() => { // the 3D interior: built when you arrive, freed when you leave
    let dead = false, scene = null;
    (async () => {
      try {
        const [{ buildInterior, buildOpenInterior, classify, PLAN_NOTE }, { createInteriorScene }, { activityHubs }] = await Promise.all([import("@/lib3d/interiors/index.js"), import("@/lib3d/interiors/scene.js"), import("@/lib3d/interiors/activityHubs.js")]);
        const c = buildInterior(place) ?? buildOpenInterior(place); if (!c) { setStatus("none"); return; } setNote(c.plan?.family === "open" ? "An open space: students, and the real players who are here, share it with you." : PLAN_NOTE);
        const L = await call("/api/lecture?at=" + encodeURIComponent(place.id)); if (!L.failed) { lec.current = L; if (L.incident?.active && L.incident.venue.placeId === place.id) setIncident(L.incident); } // a response already under way (you came back to this screen): picked up below
        const lecturers = (lec.current.courses ?? []).map((x) => ({ code: x.code, name: x.lecturer.name, difficulty: x.lecturer.difficulty, npcIndex: x.venue.npcIndex }));
        // the activity rings: placed by the same code the server uses to check where you stand (lib3d/interiors/activityHubs.js), drawn teal
        const list = activityHubs(c, classify(place.id, place.kind).spec).hubs.map((h) => ({ ...h, activity: h.id, tint: "#5fe3c0" })); c.hubs = [...c.hubs, ...list]; setRings(list); if (dead || !box.current) return;
        scene = await createInteriorScene(box.current, c, { look, gender, selfName: selfRef.current, club: isClub(place.id), barSpot: (() => { const b = list.find((h) => h.act === "club_drink"); return b ? { x: b.x, z: b.z } : null; })(), input, view: cell ? "overhead" : getPrefs().gameplay.interiorView, lecturers, cell, lockedCells: lockedOf(c, place), onFade: setFade, onIncidentEnd: (e) => setAfter(e), onExit: () => leave.current?.(), onRoom: setRoom, onNear: setNear, onChat: (m) => { toast.info(`${m.name}: ${m.line}`); setTimeout(() => { if (!dead) toast.info(`${m.name}: ${m.reply}`); }, 2600); }, onHub: (h) => { if (h.action === "lecture") { confrontRef.current?.(h.lecturer.code); return; } if (h.activity) { setOpen(h); return; } if (place.id === CUSTODY_PLACE) { deskRef.current?.(); return; } const a = place.actions?.[h.action]; if (a?.href) router.push(a.href); else setInfo(true); } });
        if (dead) { scene.dispose(); return; } api.current = scene; if (peopleRef.current) scene.setRemotePlayers(peopleRef.current); setStatus("ready"); setSceneReady(true);
      } catch (e) { console.warn("interior unavailable", e); if (!dead) setStatus("fallback"); }
    })();
    return () => { dead = true; api.current = null; setSceneReady(false); scene?.dispose(); };
  }, [place.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // your saved look changed while you are inside (Settings): the character you walk around as is rebuilt from it
  const myLookKey = lookKey(look, gender);
  useEffect(() => { if (sceneReady) api.current?.setSelfLook(look, gender); }, [myLookKey, sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- confronting a lecturer ----
  async function confront(code) {
    if (fight || incident) return;
    const L = await call("/api/lecture?at=" + encodeURIComponent(place.id)); if (L.failed) return toast.error(L.error || "Could not reach the server.");
    lec.current = L; const c = L.courses.find((x) => x.code === code); if (!c) return toast.error("That lecturer is not in this building.");
    if (!c.canConfront) return toast.error(c.reason || "You cannot confront them now.");
    const ok = await confirmAction({ title: `Fight ${c.lecturer.name}?`, message: `Beat them and there is an 80% chance N-QRS comes: they rescue the lecturer and arrest YOU. They seize 30% of your cash, you get a strike, and you serve your whole sentence in Floor O (N-QRS Custody). Lose and you get hurt. Costs ${L.energyCost} energy. Once a week.`, confirmLabel: "Fight", tone: "danger" });
    if (!ok) return;
    const r = await call("/api/lecture", { action: "approach", code, requestId: crypto.randomUUID() });
    if (r.failed) return toast.error(r.error || "You could not walk up to them.");
    setFight({ course: { code, difficulty: c.lecturer.difficulty, lecturer: { name: c.lecturer.name } }, encounter: r.encounter });
  }
  confrontRef.current = confront;
  const settled = (res) => { setFight(null); if (res.incident) { setIncident(res.incident); } };
  // act out the response as soon as the room is drawn: where it stands comes from the server's clock, so a refresh or a second device lands on the same moment
  useEffect(() => {
    if (!incident || !sceneReady || !api.current) return;
    if (incident.venue.placeId !== place.id) return;
    if (!incident.active && played.current !== incident.id) { setAfter({ id: incident.id, outcome: incident.outcome }); played.current = incident.id; return; } // it is already over
    played.current = incident.id;
    api.current.playIncident({ id: incident.id, outcome: incident.outcome, settledAt: incident.settledAt, npcIndex: incident.venue.npcIndex, clock: serverTime });
  }, [incident, sceneReady, place.id]);
  const finish = () => { // the result card's button
    const arrested = incident?.outcome === "ARRESTED"; setAfter(null); setIncident(null); setFade(0); game.refresh(); api.current?.stopIncident();
    if (arrested) { if (onCustody) onCustody(); else onLeave(); }
  };
  // Arrived from "Go and start" on the map: walk to the ring of that activity, then open its panel once the character stands at it.
  const goal = useRef(null), pendingOpen = useRef(null);
  useEffect(() => {
    if (!focus || !sceneReady || !api.current || goal.current === focus) return;
    const ring = rings.find((r) => r.act === focus); goal.current = focus; if (!ring) return; // the building has no such ring: just stay at the door
    api.current.walkTo(ring.x, ring.z).then((ok) => { if (ok === false) toast.info("Walk to the glowing ring to start it."); });
    pendingOpen.current = ring;
  }, [focus, sceneReady, rings]);
  useEffect(() => { if (pendingOpen.current && near && near.activity === pendingOpen.current.activity) { setOpen(pendingOpen.current); pendingOpen.current = null; } }, [near]);
  useEffect(() => { if (open && !(near && near.activity === open.activity)) setOpen(null); }, [near, open]); // walking away from a ring closes its panel
  useEffect(() => { const k = (e) => { if (e.key !== "Escape") return; if (open) setOpen(null); else if (info) setInfo(false); else if (!cell) onLeave(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onLeave, info, open]);

  // ---- the charge desk in Floor O ("Settle your bill") ----
  // A prisoner is held INSIDE Floor O. Settling the bill is done here, in the custody panel; it never sends them to /home (that is the player's own room).
  const gs = useGame(), [desk, setDesk] = useState(false), [paying, setPaying] = useState(false), [, setTick] = useState(0), deskRef = useRef(null);
  deskRef.current = () => { if (place.id === CUSTODY_PLACE && isJailed(game.get()?.character ?? {}, serverTime())) setDesk(true); else toast.info("The charge desk is for people being held here. Nobody is booked in under your name."); };
  useEffect(() => { if (!desk) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [desk]);
  const heldUntil = gs?.floorZero?.releaseAt ?? gs?.character?.jailedUntil ?? null, stillHeld = !!heldUntil && +new Date(heldUntil) > serverTime();
  useEffect(() => { if (desk && gs && !stillHeld) { setDesk(false); game.refresh(); } }, [desk, gs, stillHeld]); // the sentence ended while the panel was open
  async function settleBill() {
    if (paying) return; setPaying(true);
    const r = await call("/api/floor0/pay", {}); setPaying(false);
    if (r.failed) return toast.error(r.error || "Could not pay the bail. Try again.");
    toast.success(r.served ? "Your sentence is over. You are free." : "Bail paid. You are free.", { sound: "coin" });
    setDesk(false); await game.refresh(); onLeave();
  }
  const deskMs = heldUntil ? Math.max(0, +new Date(heldUntil) - serverTime()) : 0, deskBail = heldUntil ? bailFor(heldUntil, serverTime()) : 0n;
  const deskMmSs = `${Math.floor(deskMs / 3600000)}h ${String(Math.floor(deskMs / 60000) % 60).padStart(2, "0")}m ${String(Math.floor(deskMs / 1000) % 60).padStart(2, "0")}s`;
  const deskPanel = desk && (
    <div className="bi" role="dialog" aria-modal="true" aria-label={CUSTODY_NAME} style={{ zIndex: 60 }} onClick={(e) => { if (e.target === e.currentTarget) setDesk(false); }}>
      <div className="bi-card">
        <span className="bi-ico"><Icon name="siren" size={30} weight="fill" /></span>
        <small>Charge desk</small>
        <h2>{CUSTODY_NAME}</h2>
        <p>You are being held here and you serve your whole sentence inside. Pay the bill to walk out early, or wait it out. You can still message other players.</p>
        <p><b>Time left:</b> {deskMmSs}<br /><b>Bill to leave now:</b> {naira(deskBail.toString())}</p>
        <button type="button" className="go" disabled={paying || !stillHeld} onClick={settleBill}><Icon name="door" size={18} /> {paying ? "Paying…" : `Pay ${naira(deskBail.toString())} and leave`}</button>
        <button type="button" onClick={() => setDesk(false)}>Back to walking</button>
      </div>
    </div>
  );
  const card = (
    <div className="bi" role="dialog" aria-modal="true" aria-label={`About ${place.name}`} data-over={status === "ready" ? "1" : undefined} onClick={(e) => { if (status === "ready" && e.target === e.currentTarget) setInfo(false); }}>
      <div className="bi-card">
        <span className="bi-ico"><Icon name={ICON_OF[place.kind] ?? "town"} size={30} weight="fill" /></span>
        <small>You are inside</small>
        <h2>{place.name}</h2>
        <p>{place.blurb}</p>
        {isClub(place.id) && (() => { const cs = clubStatus(serverTime()); return <p className="mut" role="status"><b>{cs.label}</b> · Opening hours {HOURS_LABEL} (game time) · {cs.note}</p>; })()}
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
      {deskPanel}
      <div className="bi3-view" ref={box} />
      {status === "loading" && <div className="bi3-load" role="status"><Icon name="door" size={30} /><b>Going in…</b></div>}
      {status === "ready" && (
        <div className="th bi3-hud">
          <div className="bi3-top">
            {cell ? <span className="bi3-btn bi3-lock" aria-label="You are held in a cell"><Icon name="lock" size={18} /> Cell</span> : <button type="button" className="bi3-btn" onClick={onLeave} data-sound="none"><Icon name="door" size={18} /> Exit</button>}
            <div className="bi3-title"><b>{place.name}</b><span>{room}</span></div>
            <button type="button" className="bi3-btn" aria-label="Switch between close view and top view" onClick={() => setView(api.current?.toggleView() ?? "follow")} data-sound="none"><Icon name={view === "follow" ? "eye" : "focus"} size={18} /></button>
            <button type="button" className="bi3-btn" aria-label="About this place" onClick={() => setInfo(true)} data-sound="none"><Icon name="users" size={18} /></button>
          </div>
          {near && !open && <button type="button" className={`bi3-use${near.activity ? " act" : ""}`} onClick={() => api.current?.use()} data-sound="none"><Icon name={near.activity ? "timer" : "sparkle"} size={18} weight="fill" /> {near.label} <kbd>F</kbd></button>}
          <ActivityLayer api={api} rings={rings} open={open} ready onClose={() => setOpen(null)} onLeave={onLeave} />
          {isClub(place.id) && <ClubLayer place={place} api={api} ready={sceneReady} selfName={selfName} people={people ?? []} onLeave={onLeave} />}
          {banner}
          <p className="bi3-help">{cell ? "Walk around your cell with WASD or the stick · drag to look · V changes view · open the phone for messages, bank and games" : "Walk with WASD or the stick · Shift to run · drag to look · V changes view · walk out of the door to leave"}</p>
          <Stick input={input} />
          <Hold className="th-btn th-run" label="Run" onDown={() => input.hold(true)} onUp={() => input.hold(false)}>RUN</Hold>
        </div>
      )}
      {fight && <LectureFight course={fight.course} encounter={fight.encounter} onSettled={settled} onClose={() => { setFight(null); game.refresh(); }} />}
      {fade > 0 && <div className="bi3-fade" style={{ opacity: fade }} aria-hidden="true" />}
      {after && incident && <div className="lf-after"><ResultCard res={{ won: true, caught: incident.apprehended, ...incident }} name={incident.lecturer.name} onClose={finish} /></div>}
      {info && card}
    </div>
  );
}