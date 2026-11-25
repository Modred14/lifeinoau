// components/HomeWorld.js
// The home screen's world: the player's own house, yard and garage exactly as the map draws them (the same scene, the same lot beside the real road), with the player standing inside the house.
// They walk about indoors, step out through the front door, walk to the garage, get into their car and drive out of the gate onto the main road, all in the one scene with no loading between.
// Two views, switched by the player (and remembered): "Behind you" (third person, the roof melts away while you are inside) and "Cutaway" (from above, roof off, the whole inside in view).
// The room scene (components/RoomStage.js) is still used for Buy mode (moving furniture) and for going to sleep.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import TripHud from "./TripHud";
import { Icon } from "./Icon";
import { loadCampusData } from "../lib3d/campusData.js";
import { loadHomeOption, forgetHomeOption } from "@/lib/homeOption.js";
import { game, useGame } from "@/lib/gameStore";
import { call } from "@/lib/client";
import { toast } from "@/lib/toast";
import { homePlace, ownsCar } from "@/lib/travel.js";
import "./home-world.css";

const CampusMap = dynamic(() => import("./CampusMap"), { ssr: false });
const VIEW_KEY = "oau:homeView";
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === "cutaway" ? "cutaway" : "chase"; } catch { return "chase"; } };

export default function HomeWorld({ onSleep = null }) {
  const router = useRouter(), g = useGame(), ch = g?.character;
  const [data, setData] = useState(null), [hm, setHm] = useState(null), [ready, setReady] = useState(false), [trip, setTrip] = useState(null), [st, setSt] = useState(null), [view, setView] = useState(readView), [failed, setFailed] = useState(false);
  const input = useRef({}).current, miniRef = useRef(null), previewRef = useRef(null), tripApi = useRef(null), parkP = useRef(null), viewRef = useRef(view), chRef = useRef(ch), startedAt = useRef(0);
  viewRef.current = view; chRef.current = ch;

  useEffect(() => { let on = true; loadCampusData().then((d) => on && setData(d)).catch(() => on && setFailed(true)); return () => { on = false; }; }, []);
  useEffect(() => { if (!ch) return; let on = true; loadHomeOption(ch, ch.activeCar || "").then((h) => { if (!on) return; if (h) setHm(h); else setFailed(true); }); return () => { on = false; }; }, [!!ch]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The trip that stands in the player's compound: on foot just inside the front door, or (after getting out of / into another car) on foot at `x.pose` with the walk to the chosen car begun. */
  const homeTrip = useCallback((c, h, x = {}) => ({
    id: crypto.randomUUID(), from: homePlace(c.hostel), to: homePlace(c.hostel), mode: ownsCar(c) ? "car" : "trek", driver: false, act: null, free: true, home: h, homeInterior: true, roam: true,
    onHomePark: (pose) => { const m = game.get()?.character?.activeCar; if (m) parkP.current = call("/api/rides", { action: "park", modelId: m, pose }); },
    onSwitchCar: switchCar, autoEnter: !!x.autoEnter, pose: x.pose ?? null, spawn: null, look: c.look ?? null, gender: c.gender ?? "M", car: x.modelId ?? (c.activeCar || ""), carColor: x.color ?? (c.activeCarColor || ""),
    people: [], isEnterable: () => false, selfName: c.name ?? "", name: "your home",
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Another of the player's cars: it becomes the active one (at once locally, then the same "use" call the Ride app makes), the compound is re-read with every car where it stands, and the trip restarts beside that car.
  async function switchCar({ id, pose, pinned }) {
    const c = chRef.current, owned = await loadHomeOption(c, game.get()?.character?.activeCar ?? ""), v = owned?.vehicles?.find((q) => String(q.id) === String(id)); if (!v) return;
    const op = game.push((s) => (s ? { ...s, character: { ...s.character, activeCar: v.modelId, activeCarColor: v.family ? "" : v.color } } : s));
    try { await parkP.current; } catch { /* the save failed: the server decides below */ }
    const r = await call("/api/rides", { action: "use", modelId: v.modelId });
    if (r.failed) { if (op != null) game.rollback(op); toast.error(r.error || "That vehicle could not be selected."); return; }
    if (op != null) game.done(op);
    forgetHomeOption(); const now = game.get()?.character ?? c, h = await loadHomeOption(now, v.modelId);
    if (h && pinned) { const at = new Map(pinned.map((q) => [String(q.id), q.saved])); h.vehicles = h.vehicles.map((q) => (q.saved ? q : { ...q, saved: at.get(String(q.id)) ?? null })); }
    setTrip(homeTrip(now, h, { pose, modelId: v.modelId, color: v.family ? "" : v.color, autoEnter: true }));
  }

  // the trip starts once the map's scene is drawn and the player's home is known
  useEffect(() => { if (trip || failed || !ready || !data || !hm || !ch) return; setSt(null); input.jx = input.jy = input.steer = input.gas = input.brake = 0; input.run = false; startedAt.current = Date.now(); setTrip(homeTrip(ch, hm)); }, [ready, data, hm, !!ch, !!trip, failed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* the choice is just not remembered */ } tripApi.current?.setHomeView?.(view); }, [view]);
  useEffect(() => { document.body.dataset.trip = "1"; return () => { delete document.body.dataset.trip; }; }, []);

  const loading = !trip || !st;
  return (
    <div className="hw" data-view={view}>
      <CampusMap pins={false} trip={trip} tripInput={input} getMini={() => miniRef.current} getPreview={() => previewRef.current} tripApi={tripApi}
        onTripState={setSt} onTripEnd={(why) => { const quick = Date.now() - startedAt.current < 4000; setTrip(null); if (why === "error") toast.error("Your home could not open. Try again."); if (why === "error" || quick) setFailed(true); /* a trip that ends the moment it starts (the server will not have you out) is not started over and over */ }} onTripNotice={(m) => toast.error(m)} onTripReady={() => tripApi.current?.setHomeView?.(viewRef.current)} onReady={() => setReady(true)} />
      {trip && <TripHud trip={trip} placeName="Your home" st={st} input={input} miniRef={miniRef} previewRef={previewRef} onCancel={() => setTrip(null)} />}
      {loading && !failed && <div className="hw-loading" role="status" aria-busy="true"><span className="rs-spin" />Opening your home</div>}
      {failed && <div className="hw-loading hw-err" role="alert"><span>Your home could not open right now.</span><button type="button" className="hw-btn" onClick={() => setFailed(false)}>Try again</button></div>}
      {trip && st && (
        <div className="hw-tools" role="toolbar" aria-label="Home">
          <div className="hw-seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "chase"} onClick={() => setView("chase")}><Icon name="person" size={16} /> Behind you</button>
            <button type="button" aria-pressed={view === "cutaway"} onClick={() => setView("cutaway")}><Icon name="hostel" size={16} /> Cutaway</button>
          </div>
          {onSleep && <button type="button" className="hw-btn" onClick={onSleep}><Icon name="moon" size={16} /> Sleep</button>}
          <button type="button" className="hw-btn" onClick={() => router.push("/map")}><Icon name="map" size={16} /> Map</button>
        </div>
      )}
    </div>
  );
}
