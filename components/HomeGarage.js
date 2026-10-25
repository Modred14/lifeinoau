// components/HomeGarage.js
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";
import { game } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { Icon } from "./Icon";
import "./home-garage.css";

/** Player-specific garage. /api/rides scopes ownership to the signed-in character. */
export default function HomeGarage({ character, onBack }) {
  const router = useRouter(), canvas = useRef(null), scene = useRef(null), [rides, setRides] = useState(null), [error, setError] = useState(""), [selected, setSelected] = useState(null), [near, setNear] = useState(null), [busy, setBusy] = useState(false), [drv, setDrv] = useState(null); // drv: null, or { speed, onRoad, hit, reverse } while the player is driving
  const load = useCallback(async () => { const r = await call("/api/rides"); if (r.failed) { setError(r.error || "Your vehicles could not load."); return; } setError(""); setRides(r); }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 10000), focus = () => void load(), refresh = () => void load(); window.addEventListener("focus", focus); window.addEventListener("game:refresh", refresh); return () => { clearInterval(t); window.removeEventListener("focus", focus); window.removeEventListener("game:refresh", refresh); }; }, [load]);
  const vehicles = useMemo(() => { if (!rides) return []; const cars = rides.owned.map((o) => { const c = rides.cars.find((x) => x.id === o.modelId); return c ? { ...c, id: c.id, modelId: c.id, color: o.color } : null; }).filter(Boolean); if (rides.family) cars.unshift({ id: "family-car", modelId: "", name: "Family car", year: "", body: "Sedan", color: "#263647", family: true }); return cars; }, [rides]);
  const vehicleKey = vehicles.map((v) => `${v.id}:${v.color}`).join("|");
  useEffect(() => { if (!rides || !canvas.current) return; let alive = true, current = null;
    import("../lib3d/homeGarage.js").then(({ createHomeGarage }) => { if (!alive) return; current = createHomeGarage(canvas.current, vehicles, { look: character?.look, gender: character?.gender,
      onSelect: (id) => setSelected(id), onNear: (id) => setNear(id), onDrive: (d) => setDrv(d.driving ? d : null) }); scene.current = current; }).catch((e) => { console.error("garage scene unavailable", e); if (alive) setError("The 3D garage could not start on this device."); });
    return () => { alive = false; scene.current = null; current?.dispose(); };
  }, [vehicleKey, character?.look, character?.gender]); // rebuild only when ownership or paint changes
  const car = vehicles.find((v) => String(v.id) === String(selected)) ?? null;
  async function drive() { if (!car || busy || near == null || String(near) !== String(car.id)) return; setBusy(true); const r = await call("/api/rides", { action: "use", modelId: car.modelId }); setBusy(false); if (r.failed) return toast.error(r.error || "That vehicle could not be selected.");
    game.pushDone((s) => s ? { ...s, character: { ...s.character, activeCar: car.modelId, activeCarColor: car.color } } : s);
    if (scene.current?.startDrive(car.id)) { setDrv({ speed: 0, onRoad: false, hit: null }); return; } // drive out of the garage along the driveway; the map is one tap away once on the road
    toast.success(`${car.name} is ready. Head out on the map to drive.`); onBack?.(); router.push("/map");
  }
  function park() { scene.current?.stopDrive({ park: true }); setDrv(null); setSelected(null); setNear(null); }
  function toMap() { if (!drv?.onRoad) return; const car2 = car; scene.current?.stopDrive({ park: false }); setDrv(null); toast.success(`${car2?.name ?? "Your car"} is on the road. Pick a destination on the map.`); onBack?.(); router.push("/map"); }
  // a held button: sets one axis of the virtual stick for as long as the finger (or mouse button) is down, and always lets go
  const hold = (axis, value) => ({
    onPointerDown: (e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} scene.current?.setInput({ [axis]: value }); },
    onPointerUp: () => scene.current?.setInput({ [axis]: 0 }), onPointerCancel: () => scene.current?.setInput({ [axis]: 0 }), onLostPointerCapture: () => scene.current?.setInput({ [axis]: 0 }),
    onContextMenu: (e) => e.preventDefault(),
  });
  return <div className="hg" aria-label="Your private home garage">
    <div ref={canvas} className="hg-canvas" role="application" aria-label="3D home garage. Tap a vehicle to walk over to it; tap the ground to walk around the parking area. When you drive, use the on-screen buttons or the arrow keys." />
    {error && <div className="hg-error" role="alert">{error}<button type="button" onClick={load}>Retry</button></div>}
    {!rides && !error && <div className="hg-loading" role="status"><i />Loading your vehicles…</div>}
    <div className="hg-label"><b>{character?.hostel || "Home"} · Private parking</b><span>{vehicles.length ? `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} parked` : "Your driveway is ready"}</span></div>
    {drv && <>
      <section className="hg-hud" aria-live="polite"><b>{drv.speed}<small> km/h</small></b><span>{drv.hit ? "Blocked. Reverse and steer around it." : drv.onRoad ? "You are on the road." : "Follow the driveway to the gate and out onto the road."}</span>
        <div className="hg-hud-btns"><button type="button" onClick={park}>Park</button><button type="button" className="hg-go" onClick={toMap} disabled={!drv.onRoad}>{drv.onRoad ? "Continue on the map" : "Drive to the road"}<Icon name="right" size={16} /></button></div></section>
      <div className="hg-pad" role="group" aria-label="Driving controls. Keyboard: arrow keys or W A S D.">
        <div className="hg-steer"><button type="button" aria-label="Steer left" {...hold("steer", -1)}><Icon name="left" size={26} /></button><button type="button" aria-label="Steer right" {...hold("steer", 1)}><Icon name="right" size={26} /></button></div>
        <div className="hg-pedals"><button type="button" className="hg-brake" aria-label="Brake and reverse" {...hold("throttle", -1)}>Brake<small>Reverse</small></button><button type="button" className="hg-gas" aria-label="Accelerate" {...hold("throttle", 1)}>Go</button></div>
      </div></>}
    {car && !drv && <section className="hg-card" aria-live="polite"><button className="hg-x" type="button" aria-label="Close vehicle details" onClick={() => { setSelected(null); setNear(null); scene.current?.select(null); }}><Icon name="close" size={16} /></button>
      <span className="hg-eyebrow">{near != null && String(near) === String(car.id) ? "At your vehicle" : "Walking to vehicle"}</span><b>{car.name}</b><span className="hg-meta">{car.year ? `${car.year} · ${car.body}` : "Ready for your next trip"}</span>
      <button type="button" className="hg-drive" onClick={drive} disabled={busy || near == null || String(near) !== String(car.id)}>{busy ? "Getting vehicle ready…" : near != null && String(near) === String(car.id) ? "Enter and drive" : "Walk closer to use"}<Icon name="right" size={16} /></button>
    </section>}
    {rides && !vehicles.length && !drv && <div className="hg-empty"><b>No vehicles parked yet</b><span>Buy a car from the Ride app and it will appear here.</span></div>}
  </div>;
}
