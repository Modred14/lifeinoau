// src/app/map/page.js
"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ICON_OF, KIND_LABEL, MAP_GROUPS } from "@/lib3d/landmarks.js";
import { loadCampusData, listPlaces, buildingPlace } from "@/lib3d/campusData.js";
import { Icon } from "@/components/Icon";
import BillboardPanel from "@/components/BillboardPanel";
import TravelSheet from "@/components/TravelSheet";
import TripHud from "@/components/TripHud";
import RoadTransition from "@/components/RoadTransition";
import { peekDriveHandoff, takeDriveHandoff } from "@/lib/driveHandoff.js";
import { loadHomeOption, forgetHomeOption } from "@/lib/homeOption.js";
import PlaceActivities from "@/components/PlaceActivities";
import { featuresAt } from "@/lib/features.js";
import { showsActivitiesOutside, wantedAct } from "@/lib/activityVisibility.js";
import BuildingInside from "@/components/BuildingInside";
import CustodyCell from "@/components/CustodyCell";
import { createTargetTracker } from "@/lib/tripTarget.js";
import { hasInterior } from "@/lib3d/interiors/registry.js";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game, useGame, run, cash } from "@/lib/gameStore";
import { saveRoadParking, takeRoadParking } from "@/lib/roadParking.js";
import { fareKobo, placeOf, ownsCar, driverActive, homePlace, MODE_INFO } from "@/lib/travel.js";
import { playSound } from "@/lib/sound";
import { serverTime } from "@/lib/serverClock";
import { occupancy } from "@/lib/occupancyClient";
import { isClub, clubOf, clubStatus, closedMessage, HOURS_LABEL } from "@/lib/clubs.js";
import { CUSTODY_NAME } from "@/lib/discipline";

const CampusMap = dynamic(() => import("@/components/CampusMap"), {
  ssr: false,
});

export default function MapPage() {
  const [sel, setSel] = useState(null),
    [list, setList] = useState(false),
    [places, setPlaces] = useState([]),
    [q, setQ] = useState("");
  const [bb, setBb] = useState(null);
  const [data, setData] = useState(null), [sheet, setSheet] = useState(false), [trip, setTrip] = useState(null), [tripSt, setTripSt] = useState(null), [inside, setInside] = useState(null), [fade, setFade] = useState(false), [counts, setCounts] = useState({}), [focus, setFocus] = useState(null), [want, setWant] = useState(null);
  const g = useGame(), ch = g?.character, here = ch ? placeOf(ch) : null, miniRef = useRef(null), previewRef = useRef(null), input = useRef({}).current, tripRef = useRef(null), targetRef = useRef(null), exitRef = useRef(null), readyRef = useRef(null), [warm, setWarm] = useState(false);
  const [leaving, setLeaving] = useState(false); // on the way out while the room is still on screen (the doorstep world is being drawn): the activity UI is already gone
  tripRef.current = trip;
  // Driving out of the home compound: the "Entering Main Road…" screen is up from the first frame, and as soon as the map is ready the same vehicle (model, paint, speed) is put on the road
  // beside the player's home, at the wheel, as a free drive (lib3d/tripflow.js): the usual controls, the usual name tags, and the position goes to other players as for any trip.
  const [entering, setEntering] = useState(() => !!peekDriveHandoff()), [mapReady, setMapReady] = useState(false), [enterSnap] = useState(() => peekDriveHandoff()?.snap ?? ""); // enterSnap: the home screen's last frame, shown instead of a dark screen
  // the home option is fetched the moment the map page opens (in parallel with the map's own loading), not after it
  const parkP = useRef(null);   // the save of the last parked car, so a car swap never reads the server before it has landed
  // The trip that stands in the player's own compound: on foot at the pose, or at the wheel in the gate. `x` = { home, walk, pose, v, modelId, color, autoEnter }.
  const homeTrip = (ch, hm, x) => { const home = x.home; return ({ id: crypto.randomUUID(), from: home, to: home, mode: ownsCar(ch) || x.modelId ? "car" : "trek", driver: false, act: null, free: true, home: hm, roam: !!(hm && x.walk), onHomePark: hm ? (pose) => { const m = game.get()?.character?.activeCar; if (m) parkP.current = call("/api/rides", { action: "park", modelId: m, pose }); } : undefined, onSwitchCar: hm ? switchCar : undefined, autoEnter: !!x.autoEnter, pose: hm ? x.pose ?? null : null, spawn: x.walk ? null : { v: x.v }, look: ch.look ?? null, gender: ch.gender ?? "M", car: x.modelId, carColor: x.color, people: [], isEnterable: (id) => { const p = find(id); return !!p && hasInterior(p.id, p.kind); }, selfName: ch.name ?? "", name: "the main road" }); };
  // Get into another car of yours that stands in the compound: it becomes the active car (local first, the same "use" call the compound screen makes), the compound is re-read with every
  // car where it stands, and the trip restarts on foot at the same spot with the walk to that car's door already begun.
  const switchCar = async ({ id, pose, pinned }) => {
    const ownedNow = (await loadHomeOption(ch, game.get()?.character?.activeCar ?? "")), v = ownedNow?.vehicles?.find((q) => String(q.id) === String(id)); if (!v) return;
    const before = game.get()?.character, op = game.push((s) => (s ? { ...s, character: { ...s.character, activeCar: v.modelId, activeCarColor: v.family ? "" : v.color } } : s));
    try { await parkP.current; } catch {}
    const r = await call("/api/rides", { action: "use", modelId: v.modelId });
    if (r.failed) { if (op != null) game.rollback(op); toast.error(r.error || "That vehicle could not be selected."); return; }
    if (op != null) game.done(op);
    forgetHomeOption(); const hm = await loadHomeOption(game.get()?.character ?? ch, v.modelId);
    if (hm && pinned) { const at = new Map(pinned.map((q) => [String(q.id), q.saved])); hm.vehicles = hm.vehicles.map((q) => (q.saved ? q : { ...q, saved: at.get(String(q.id)) ?? null })); }   // a car nobody has parked yet stays exactly where it stands, whatever order the cars are planned in
    setTrip(homeTrip(game.get()?.character ?? ch, hm, { home: homePlace((game.get()?.character ?? ch).hostel), walk: true, pose, modelId: v.modelId, color: v.family ? "" : v.color, autoEnter: true }));
  };
  useEffect(() => { if (entering && ch) loadHomeOption(ch, peekDriveHandoff()?.modelId ?? ""); }, [entering, !!ch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!entering || !mapReady || !data || !ch || trip) return;
    const h = takeDriveHandoff(); if (!h) { setEntering(false); return; }
    if (held || (!h.walk && !ownsCar(ch))) { setEntering(false); return; }
    const home = homePlace(ch.hostel); input.jx = input.jy = input.steer = input.gas = input.brake = 0; input.run = false; setTripSt(null);
    // the player's own compound (house, yard, garage, parked vehicles) is drawn on its lot beside the road; a drive-out starts at the wheel in the gate, a walk-out on the doorstep
    try { performance.mark("oau:arrival-start"); } catch {} loadHomeOption(ch, h.modelId).then((hm) => { try { performance.mark("oau:home-option"); } catch {} return hm; }).then((hm) => setTrip(homeTrip(ch, hm, { home, walk: h.walk, pose: h.pose ?? null, v: h.v, modelId: h.modelId, color: h.color })));
  }, [entering, mapReady, data, !!ch, !!trip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { if (entering && tripSt?.phase) performance.mark("oau:phase-" + tripSt.phase); } catch {} }, [entering, tripSt?.phase]);
  useEffect(() => { if (!entering) return; const t = tripSt?.phase === "drive" || (enterSnap && tripSt?.phase === "roam") ? setTimeout(() => setEntering(false), enterSnap ? 120 : 450) : setTimeout(() => setEntering(false), 9000); return () => clearTimeout(t); }, [entering, tripSt?.phase]);
  // Serving a sentence: held at Floor O (N-QRS Custody) and not allowed to travel. The server refuses every trip too; this only stops offering it.
  const held = !!g?.floorZero && +new Date(g.floorZero.releaseAt) > serverTime();
  // Caught: whatever flow got you arrested, you are taken straight into the cell at Floor O on the map (never to the house).
  useEffect(() => { if (held && here === "floor0" && !inside && !trip) { setFocus(null); setInside("floor0"); } }, [held, here, inside, trip]);
  const refreshBb = () =>
    call("/api/billboards").then((r) => {
      if (!r.failed) setBb(r);
    });
  useEffect(() => {
    refreshBb();
    const t = setInterval(refreshBb, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let on = true;
    loadCampusData()
      .then((d) => { if (on) { setPlaces(listPlaces(d)); setData(d); } })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  // The OAU Guide sends the player here with ?to=<place>&do=<activity> (or, when the map is already open, an "oau:goto" event):
  // open that place's panel and highlight the activity.
  useEffect(() => {
    const apply = (to, act) => { if (!to) return; setSel(to); setWant(act || null); };
    const q = new URLSearchParams(window.location.search);
    if (q.get("to")) { apply(q.get("to"), q.get("do")); window.history.replaceState(null, "", "/map"); }
    const h = (e) => apply(e.detail?.to, e.detail?.act);
    window.addEventListener("oau:goto", h);
    return () => window.removeEventListener("oau:goto", h);
  }, []);
  useEffect(() => {
    if (!list) return;
    const k = (e) => e.key === "Escape" && setList(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [list]);
  // where everybody is: a ping every minute so others see you, and the little "N here" numbers
  useEffect(() => {
    if (!ch) return; let on = true;
    const ping = () => !document.hidden && call("/api/travel", { action: "ping" });
    const cnt = async () => { const r = await call("/api/travel?counts=1"); if (on && !r.failed) setCounts(r.counts ?? {}); };
    ping(); cnt(); const a = setInterval(ping, 60000), b = setInterval(() => !document.hidden && cnt(), 20000);
    return () => { on = false; clearInterval(a); clearInterval(b); };
  }, [!!ch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (trip) document.body.dataset.trip = "1"; else delete document.body.dataset.trip; return () => { delete document.body.dataset.trip; }; }, [!!trip]);
  const find = useCallback((id) => places.find((l) => l.id === id) ?? (data && buildingPlace(data, id)) ?? null, [places, data]);
  const L = find(sel), youPlace = here ? find(here) : null,
    shown = useMemo(
      () =>
        places.filter((p) =>
          p.name.toLowerCase().includes(q.trim().toLowerCase()),
        ),
      [places, q],
    );
  // Tapping a normal building goes straight to the "How do you want to go?" sheet, which carries the building's description.
  // Billboards (they have their own panel) and the place you are standing in still use the small info card.
  const direct = !!(L && !trip && ch && !held && L.located && L.id !== here && L.kind !== "billboard");
  const closeSheet = () => { setSheet(false); if (direct) setSel(null); };
  // ---- how long each way of going would take ----
  // Worked out on this device from the road map (no network call): the road distance divided by the speed of the vehicle, plus the walk to and from it.
  // They appear one by one as each is ready, and are worked out again whenever the destination, where you are, or whether a driver is hired changes.
  const driverOn = !!ch && driverActive(ch, g?.week), [eta, setEta] = useState({}), sheetOpen = (sheet || direct) && !!L, etaTo = sheetOpen ? L.id : null;
  useEffect(() => {
    setEta({}); if (!etaTo || !data) return; let live = true;
    (async () => {
      const [{ loadServices }, { planTrip }, { resolvePlace }] = await Promise.all([import("@/lib3d/worldsvc.js"), import("@/lib3d/tripplan.js"), import("@/lib3d/travel.js")]);
      const svc = await loadServices(data), from = resolvePlace(data, here) ?? resolvePlace(data, "senate"), to = resolvePlace(data, etaTo); if (!to) return;
      const jobs = [["trek", false, "trek"], ["keke", false, "keke"], ["bus", false, "bus"], ["car", false, "car"], ...(driverOn ? [["car", true, "carDriver"]] : [])];
      for (const [mode, drv, key] of jobs) {
        await new Promise((r) => setTimeout(r, 0)); // let the screen breathe between the (quick) calculations
        if (!live) return; let r; try { const t = planTrip(svc, { from, to, mode, driver: drv }); r = t.ok ? { ok: true, secs: t.secs, len: t.len, approx: t.approx } : { ok: false, reason: t.reason }; } catch { r = { ok: false, reason: "error" }; }
        setEta((e) => ({ ...e, [key]: r }));
      }
    })().catch(() => {});
    return () => { live = false; };
  }, [etaTo, here, data, driverOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- travelling ----
  // The trip starts the moment the player taps Go. The real players standing at the door are fetched alongside (handed over as a promise)
  // and drawn when the list arrives; if that request is slow or fails, the trip is not held up and the door is simply empty.
  // Where the player left their own car on the road (lib/roadParking.js): reported by the trip when they walk away from it, handed back to the next trip that starts at that place.
  const parkKey = (c, placeId) => ({ playerId: c?.id ?? c?.name, modelId: c?.activeCar || "", placeId });
  const rememberCar = (c) => (pose, info) => { if (info?.arrived && info.placeId && c?.activeCar) saveRoadParking({ ...parkKey(c, info.placeId), color: c.activeCarColor || "", pose }); };
  function begin(mode, withDriver, act = null) {
    const dest = L; if (!dest) return; setSheet(false);
    if (held) return toast.error(`You are held in ${CUSTODY_NAME}. You cannot travel until your sentence ends.`);
    if (isClub(dest.id) && !clubStatus(serverTime()).open) return toast.error(closedMessage(clubOf(dest.id)), { duration: 7000 }); // the server refuses too: the clubs open 8 PM to 5 AM
    // who is standing at the door: always asked about the place being gone to NOW. An answer about an earlier choice (a slow one, after the player tapped another name tag) comes back null and is dropped.
    const target = (targetRef.current = createTargetTracker(dest.id));
    const fetchPeople = () => target.answer(call("/api/travel?at=" + encodeURIComponent(target.id)).then((r) => (r.failed ? [] : r.people ?? [])), null);
    const people = fetchPeople();
    setTripSt(null); input.jx = input.jy = input.steer = input.gas = input.brake = 0; input.run = false;
    setTrip({ id: crypto.randomUUID(), from: here, to: dest.id, mode, driver: withDriver, act, look: ch?.look ?? null, gender: ch?.gender ?? "M", car: ch?.activeCar || "", carColor: ch?.activeCarColor || "", parked: mode === "car" && !withDriver && ch?.activeCar ? takeRoadParking(parkKey(ch, here))?.pose ?? null : null, onCarLeft: mode === "car" && !withDriver ? rememberCar(ch) : undefined, people, pollPeople: fetchPeople, isEnterable: (id) => { const p = find(id); return !!p && hasInterior(p.id, p.kind); }, selfName: ch?.name ?? "", name: dest.name });
    setSel(null);
  }
  /** A tapped name tag has already sent the trip there (locally, at once). This keeps the page in step: the destination, its name, the people at its door. Nothing here waits for the server. */
  function retargeted(id) {
    const t = tripRef.current, p = find(id); if (!t || !p) return;
    targetRef.current?.choose(id); const next = { ...t, to: id, name: p.name, act: null }; tripRef.current = next; setTrip(next);   // same trip id: the engine keeps going, it is not restarted
  }
  /** Why a tapped place cannot be gone to right now (the server would refuse it too), or null. */
  const tripGuard = (id) => (isClub(id) && !clubStatus(serverTime()).open ? closedMessage(clubOf(id)) : null);
  async function pay() { // the vehicle has stopped: the fare leaves the wallet now, and you are at the new place
    const t = tripRef.current; if (!t) return false; const fare = fareKobo(t.mode);
    const res = await run({ key: "trip:" + t.id + ":" + t.to, sensitive: fare > 0n, pending: "Paying the fare…", ok: fare > 0n ? `Paid ${naira(fare.toString())} · ${MODE_INFO[t.mode].name}` : undefined, sound: "coin", request: () => call("/api/travel", { to: t.to, mode: t.mode, requestId: crypto.randomUUID() }),
      effects: [{ store: game, patch: (x) => ({ ...cash(-fare)(x), character: { ...x.character, placeId: t.to } }) }] });
    return !res.failed;
  }
  function entered() { // the player has walked through the door: the room (already built in the background) takes over the screen. The trip and the outdoor world are NOT ended: they stay alive underneath, so coming out is the same walk in reverse (leaveBuilding).
    const t = tripRef.current, p = t ? find(t.to) : null, indoors = !!p && hasInterior(p.id, p.kind);
    if (t && indoors) { setLeaving(false); setFocus(t.act ?? null); setInside(t.to); return; }
    setFade(true); setTimeout(() => { if (t) setSel(t.to); setTrip(null); setFade(false); }, 520); } // open-air places (billboards, grounds, statues, gates...) just end the trip with you standing there
  // the room behind the door is ready (or never will be): the trip may open the door. Until then the person waits in the doorway, never behind a loading screen.
  const roomReady = (id) => { readyRef.current = id; };
  const holdEnter = () => { const t = tripRef.current, p = t ? find(t.to) : null; return !!p && hasInterior(p.id, p.kind) && readyRef.current !== p.id; };
  /** Coming out of a building: the player walks out of ITS door onto the spot in front of it, in the same outdoor world, and carries on. Never the map, never a fade, never a reload. */
  function leaveBuilding() {
    const id = inside; setFocus(null); if (!id || id === "floor0") { setInside(null); return; }
    const r = exitRef.current?.();
    if (r?.ok) { setInside(null); return; }
    // there is no live world to step into (the player got in from the place card, or the page was reloaded): start one on the doorstep. The room stays on screen until it is drawn.
    const p = find(id); if (!p) { setInside(null); return; }
    targetRef.current = createTargetTracker(id);
    // the car they parked in front of this building (if they came by it) is still there: the doorstep world has it standing where they left it
    const left = ch && ownsCar(ch) && ch.activeCar ? takeRoadParking(parkKey(ch, id)) : null;
    setLeaving(true);
    setTrip({ id: crypto.randomUUID(), from: id, to: id, mode: left ? "car" : "trek", parked: left?.pose ?? null, onCarLeft: left ? rememberCar(ch) : undefined, roam: true, driver: false, act: null, look: ch?.look ?? null, gender: ch?.gender ?? "M", car: left ? ch.activeCar : "", carColor: left ? ch.activeCarColor || "" : "", people: [], pollPeople: () => targetRef.current.answer(call("/api/travel?at=" + encodeURIComponent(id)).then((x) => (x.failed ? [] : x.people ?? [])), null), isEnterable: (i) => { const q = find(i); return !!q && hasInterior(q.id, q.kind); }, selfName: ch?.name ?? "", name: p.name });
  }
  const tripReady = () => { if (tripRef.current?.roam) { setInside(null); setLeaving(false); } };   // the doorstep world is drawn and the player is already walking out of the door: now the room can go
  const tripEnded = (why) => {
    const t = tripRef.current;
    if (t?.roam && t.mode === "car" && !t.retried && ch && ["noroad", "unreachable", "error"].includes(why)) { setTrip({ ...t, id: crypto.randomUUID(), mode: "trek", parked: null, onCarLeft: undefined, car: "", carColor: "", retried: true }); return; }   // the car could not be put on the doorstep: come out on foot, as before
    setLeaving(false); setTrip(null); setEntering(false); if (why === "error") toast.error("The trip could not start. Try again."); };
  const tripNotice = (m) => toast.error(m); // a ride that cannot reach you, a way that is blocked: said plainly, and you can try again from the sheet
  const tripPlace = trip ? find(trip.to) : null, insidePlace = inside ? find(inside) : null;
  // Which building this player is inside, for the live "N people inside" on everybody's map (docs/BUILDING-OCCUPANCY.md). Only the id is sent: the realtime server checks it
  // against where the game has this player standing, and forgets it when they step out, move to another building, lose the connection or leave this page. Floor O (custody) is never counted.
  const insideId = inside && inside !== "floor0" ? inside : null;
  // the room is built in the background once the player is within reach of the door (and again when they walk back to it after coming out): never while the trip is far away
  const near = !!trip && tripPlace && hasInterior(tripPlace.id, tripPlace.kind) && !!tripSt && (["walk", "door", "enter", "inside", "leave"].includes(tripSt.phase) || (["trek", "afoot", "roam"].includes(tripSt.phase) && tripSt.remain <= 90));
  useEffect(() => { if (!trip) { setWarm(false); readyRef.current = null; } else if (near) setWarm(true); else if (!tripSt || tripSt.remain > 140 || tripSt.phase === "intro") setWarm(false); }, [near, !!trip, trip?.to, tripSt?.remain > 140]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!warm) readyRef.current = null; }, [warm, trip?.to]);
  const standbyPlace = !inside && warm && trip && tripPlace && tripPlace.id !== "floor0" ? tripPlace : null;
  useEffect(() => { occupancy.setInside(insideId); }, [insideId]);
  useEffect(() => () => occupancy.setInside(null), []);
  // the place card is docked on the bottom bar and the two read as one surface (globals.css .dock, bottom-nav.css). The travel sheet and the building panel set and clear the same
  // flag, so this re-asserts it whenever one of them closes while the card is still showing
  const dockOn = !!(L && !trip && !direct);
  useLayoutEffect(() => {
    if (!dockOn) return undefined;
    document.body.dataset.dock = "on";
    return () => { delete document.body.dataset.dock; };
  }, [dockOn, sheet, inside]);
  return (
    <>
      <div className="mapwrap">
        <CampusMap
          selectedId={sel}
          onSelect={(id) => { if (!trip) setSel(id); }}
          billboards={bb?.boards ?? null}
          youId={here}
          trip={trip}
          tripInput={input}
          getMini={() => miniRef.current}
          getPreview={() => previewRef.current}
          onTripState={setTripSt}
          onTripArrive={pay}
          onTripEnter={entered}
          onTripEnd={tripEnded}
          onReady={() => { try { performance.mark("oau:map-ready"); } catch {} setMapReady(true); }}
          onTripNotice={tripNotice}
          onTripRetarget={retargeted}
          tripGuard={tripGuard}
          tripHoldEnter={holdEnter}
          tripExit={exitRef}
          onTripReady={tripReady}
        />
      </div>
      {trip && !inside && <TripHud trip={trip} placeName={trip.name} st={tripSt} input={input} miniRef={miniRef} previewRef={previewRef} onCancel={() => setTrip(null)} />}
      <RoadTransition on={entering} snap={enterSnap} />
      <div className="trip-fade" data-on={fade ? "1" : undefined} aria-hidden="true" />
      {insidePlace && held && insidePlace.id === "floor0" ? <CustodyCell st={g ?? {}} look={ch?.look ?? null} gender={ch?.gender ?? "M"} selfName={ch?.name ?? ""} onFree={() => { setInside(null); setFocus(null); }} /> : (insidePlace || standbyPlace) && <BuildingInside key={(insidePlace ?? standbyPlace).id} place={insidePlace ?? standbyPlace} standby={!insidePlace} leaving={leaving} onReady={roomReady} onCustody={() => { setFocus(null); setInside("floor0"); }} look={ch?.look ?? null} gender={ch?.gender ?? "M"} focus={focus} selfName={ch?.name ?? ""} onLeave={leaveBuilding} />}
      {(sheet || direct) && L && <TravelSheet place={L} here={youPlace?.name} hasCar={ownsCar(ch)} driver={driverActive(ch, g?.week) ? { name: ch.driverName } : null} people={counts[L.id] ?? 0} distanceM={youPlace && L.located && youPlace.located ? Math.round(Math.hypot(L.x - youPlace.x, L.z - youPlace.z)) : null} character={ch} balanceKobo={g?.balanceKobo ?? null} jailed={held} highlight={want} eta={eta} onGo={begin} onClose={() => { closeSheet(); setWant(null); }} />}
      {youPlace && !trip && <div className="map-here" role="status"><Icon name="pin" size={14} weight="fill" /> {held ? <>You are held in <b>{CUSTODY_NAME}</b> until your sentence ends</> : <>You are at <b>{youPlace.name}</b></>}</div>}
      <div
        className="map-chrome"
        style={{
          position: "fixed",
          zIndex: 20,
          left: 10,
          top: "calc(var(--safe-t) + 74px)",
        }}
      >
        <button
          type="button"
          onClick={() => setList(true)}
          style={{ background: "rgba(13,19,33,0.88)" }}
        >
          <Icon name="list" /> Places
        </button>
      </div>
      {L && !trip && !direct && (
        <div className="dock map-chrome">
          <div
            className={"card" + (L.kind === "billboard" ? " bb" : "")}
            role="region"
            aria-label={L.name}
          >
            <div className="top">
              <h2>{L.name}</h2>
              <button
                type="button"
                className="ghost"
                aria-label="Close details"
                onClick={() => setSel(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {/* <p className="mut">
              <Icon name={ICON_OF[L.kind] ?? "town"} size={16} />{" "}
              {KIND_LABEL[L.kind] ?? "Place"} · {trustNote(L)}
            </p> */}
            <p>{L.blurb}</p>
            {L.kind === "billboard" && (
              <BillboardPanel
                board={Number(L.id.slice(3))}
                state={bb}
                onChanged={refreshBb}
              />
            )}
            {counts[L.id] > 0 && <p className="mut"><Icon name="users" size={15} /> {counts[L.id]} player{counts[L.id] === 1 ? "" : "s"} here now</p>}
            {isClub(L.id) && (() => { const cs = clubStatus(serverTime()); return <p className="mut" role="status"><Icon name={cs.open ? "moon" : "clock"} size={15} /> <b style={{ color: cs.open ? "var(--green-text)" : "var(--danger-text)" }}>{cs.label}</b> · Opening hours {HOURS_LABEL} · {cs.note}</p>; })()}
            <div className="row">
              {L.id === here ? (hasInterior(L.id, L.kind) ? <button type="button" className="go go-there" onClick={() => { if (isClub(L.id) && !clubStatus(serverTime()).open) return toast.error(closedMessage(clubOf(L.id)), { duration: 7000 }); setLeaving(false); setFocus(L.id === here ? wantedAct(featuresAt(L.id, L.kind).activities, want) : null); setWant(null); setInside(L.id); }}><Icon name="door" size={18} /> Go inside</button> : <p className="mut"><Icon name="pin" size={15} /> You are here. This is an open-air place, so there are no rooms to enter.</p>)
                : <button type="button" className="go go-there" disabled={!L.located || !ch || held} onClick={() => (isClub(L.id) && !clubStatus(serverTime()).open ? toast.error(closedMessage(clubOf(L.id)), { duration: 7000 }) : setSheet(true))}><Icon name="nav" size={18} weight="fill" /> {held ? "Held in Floor O" : L.located ? "Go there" : "Not on the map yet"}</button>}
            </div>
            {/* seen from outside: only an open-air place lists what can be done there. A building's activities appear once you are inside (lib/activityVisibility.js). */}
            {L.kind !== "billboard" && L.id === here && showsActivitiesOutside(L) && <PlaceActivities activities={featuresAt(L.id, L.kind).activities} links={[]} character={ch} balanceKobo={g?.balanceKobo ?? null} jailed={held} highlight={want} />}
            {L.actions?.length > 0 && showsActivitiesOutside(L) && (
              <div className="row">
                {L.actions.map((a) => (
                  <Link key={a.href} href={a.href} className="btn go">
                    {a.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {list && (
        <div className="sheet-scrim" onClick={() => setList(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Places"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="top">
              <h2>Places</h2>
              <button
                type="button"
                className="ghost"
                aria-label="Close list"
                onClick={() => setList(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            {/* <p className="mut">Building outlines, roads and names come from the OpenStreetMap map of OAU. Heights are assumed (most OAU buildings are 5 to 8 m; the Senate Building is 24 m) and shown taller than life so you can read the map. Places marked approximate were placed from another map. Ojaja, Akintola Hall, the Postgraduate hall, Floor O, the clubs and the billboards are game placements: no map shows where they really are.</p> */}
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a place"
              aria-label="Find a place"
              style={{ width: "100%", marginTop: 10, rounded: 4, padding: 6, fontSize: 16,outline: "none", border: "1px solid #888" }}
            />
            {MAP_GROUPS.map(([title, kinds]) => {
              const items = shown.filter((l) => kinds.includes(l.kind));
              if (!items.length) return null;
              return (
                <div key={title}>
                  <h3 style={{ marginTop: 16 }}>{title}</h3>
                  {items.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="ghost"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        marginTop: 6,
                      }}
                      onClick={() => {
                        setSel(l.id);
                        setList(false);
                      }}
                    >
                      <Icon name={ICON_OF[l.kind] ?? "town"} />
                      {l.name}
                      {!l.located
                        ? " (no map position yet)"
                        : l.conf === "approximate"
                          ? " (approx.)"
                          : ""}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}