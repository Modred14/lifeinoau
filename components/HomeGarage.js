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
  const router = useRouter(), canvas = useRef(null), scene = useRef(null), [rides, setRides] = useState(null), [error, setError] = useState(""), [selected, setSelected] = useState(null), [near, setNear] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await call("/api/rides"); if (r.failed) { setError(r.error || "Your vehicles could not load."); return; } setError(""); setRides(r); }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 10000), focus = () => void load(), refresh = () => void load(); window.addEventListener("focus", focus); window.addEventListener("game:refresh", refresh); return () => { clearInterval(t); window.removeEventListener("focus", focus); window.removeEventListener("game:refresh", refresh); }; }, [load]);
  const vehicles = useMemo(() => { if (!rides) return []; const cars = rides.owned.map((o) => { const c = rides.cars.find((x) => x.id === o.modelId); return c ? { ...c, id: c.id, modelId: c.id, color: o.color } : null; }).filter(Boolean); if (rides.family) cars.unshift({ id: "family-car", modelId: "", name: "Family car", year: "", body: "Sedan", color: "#263647", family: true }); return cars; }, [rides]);
  const vehicleKey = vehicles.map((v) => `${v.id}:${v.color}`).join("|");
  useEffect(() => { if (!rides || !canvas.current) return; let alive = true, current = null;
    import("../lib3d/homeGarage.js").then(({ createHomeGarage }) => { if (!alive) return; current = createHomeGarage(canvas.current, vehicles, { look: character?.look, gender: character?.gender,
      onSelect: (id) => setSelected(id), onNear: (id) => setNear(id) }); scene.current = current; }).catch((e) => { console.error("garage scene unavailable", e); if (alive) setError("The 3D garage could not start on this device."); });
    return () => { alive = false; scene.current = null; current?.dispose(); };
  }, [vehicleKey, character?.look, character?.gender]); // rebuild only when ownership or paint changes
  const car = vehicles.find((v) => String(v.id) === String(selected)) ?? null;
  async function drive() { if (!car || busy || near == null || String(near) !== String(car.id)) return; setBusy(true); const r = await call("/api/rides", { action: "use", modelId: car.modelId }); setBusy(false); if (r.failed) return toast.error(r.error || "That vehicle could not be selected.");
    game.pushDone((s) => s ? { ...s, character: { ...s.character, activeCar: car.modelId, activeCarColor: car.color } } : s); toast.success(`${car.name} is ready. Head out on the map to drive.`); onBack?.(); router.push("/map");
  }
  return <div className="hg" aria-label="Your private home garage">
    <div ref={canvas} className="hg-canvas" role="application" aria-label="3D home garage. Tap a vehicle to walk over to it; tap the ground to walk around the parking area." />
    {error && <div className="hg-error" role="alert">{error}<button type="button" onClick={load}>Retry</button></div>}
    {!rides && !error && <div className="hg-loading" role="status"><i />Loading your vehicles…</div>}
    <div className="hg-label"><b>{character?.hostel || "Home"} · Private parking</b><span>{vehicles.length ? `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} parked` : "Your driveway is ready"}</span></div>
    {car && <section className="hg-card" aria-live="polite"><button className="hg-x" type="button" aria-label="Close vehicle details" onClick={() => { setSelected(null); setNear(null); scene.current?.select(null); }}><Icon name="close" size={16} /></button>
      <span className="hg-eyebrow">{near != null && String(near) === String(car.id) ? "At your vehicle" : "Walking to vehicle"}</span><b>{car.name}</b><span className="hg-meta">{car.year ? `${car.year} · ${car.body}` : "Ready for your next trip"}</span>
      <button type="button" className="hg-drive" onClick={drive} disabled={busy || near == null || String(near) !== String(car.id)}>{busy ? "Getting vehicle ready…" : near != null && String(near) === String(car.id) ? "Enter and drive" : "Walk closer to use"}<Icon name="right" size={16} /></button>
    </section>}
    {rides && !vehicles.length && <div className="hg-empty"><b>No vehicles parked yet</b><span>Buy a car from the Ride app and it will appear here.</span></div>}
  </div>;
}
