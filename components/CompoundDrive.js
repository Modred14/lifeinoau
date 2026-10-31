// components/CompoundDrive.js
// The vehicles of the home compound, on the home screen (the 3D room draws them: lib3d/compoundFleet.js). `useVehicles` loads what the player owns; <CompoundDrive> turns
// a tap on a parked vehicle into driving it at once, shows the speed and the driving controls, and, when the vehicle rolls out of the gate onto the road, shows the
// "Entering Main Road…" screen and hands the vehicle over to the map (lib/driveHandoff.js).
//
// Everything happens locally first: getting in does not wait for the server. Choosing the vehicle is sent in the background (the same /api/rides "use" the Ride app makes, which only
// ever accepts a vehicle you own); if the server refuses it, the drive is stopped, the vehicle goes back to its place and the screen says why. Leaving the gate waits for that answer.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";
import { game } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { setDriveHandoff, clearDriveHandoff } from "@/lib/driveHandoff.js";
import { Icon } from "./Icon";
import RoadTransition from "./RoadTransition";
import "./home-garage.css";

const FAMILY = { id: "family-car", modelId: "", name: "Family car", color: "#263647", family: true };

/** Every vehicle the signed-in player owns, as [{ id, modelId, name, color }] (the family car first, for a player who has one). Refreshes quietly. */
export function useVehicles() {
  const [rides, setRides] = useState(null);
  const load = useCallback(async () => { const r = await call("/api/rides"); if (!r.failed) setRides(r); }, []);
  useEffect(() => {
    void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 15000), again = () => void load();
    window.addEventListener("focus", again); window.addEventListener("game:refresh", again);
    return () => { clearInterval(t); window.removeEventListener("focus", again); window.removeEventListener("game:refresh", again); };
  }, [load]);
  const list = useMemo(() => {
    if (!rides) return null;
    const cars = rides.owned.map((o) => { const c = rides.cars.find((x) => x.id === o.modelId); return c ? { id: c.id, modelId: c.id, name: c.name, color: o.color } : null; }).filter(Boolean);
    return rides.family ? [FAMILY, ...cars] : cars;
  }, [rides]);
  const key = list ? list.map((v) => `${v.id}:${v.color}`).join("|") : null;
  return useMemo(() => list, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- a new array only when ownership or paint really changed
}

export default function CompoundDrive({ vehicles, api, handlers, onDriving }) {
  const router = useRouter(), [drv, setDrv] = useState(null), [entry, setEntry] = useState(null), [leaving, setLeaving] = useState(false), pending = useRef(null), live = useRef({ vehicles, drv });
  live.current = { vehicles, drv };
  const driving = !!drv; useEffect(() => { onDriving?.(driving); }, [driving]); // eslint-disable-line react-hooks/exhaustive-deps

  const abort = useCallback((why) => { api.current?.stopDrive({ park: true }); setLeaving(false); setDrv(null); if (why) toast.error(why); }, [api]);

  useEffect(() => {
    handlers.current = {
      onDrive: (d) => setDrv(d.driving ? d : null),
      onEntry: (e) => setEntry(e?.phase ? e : null),
      onVehicle(id) {
        const v = live.current.vehicles?.find((x) => String(x.id) === String(id)); if (!v || live.current.drv || !api.current) return;
        const before = game.get()?.character, same = before && (before.activeCar || "") === v.modelId && (before.activeCarColor || "") === (v.family ? "" : v.color);
        const op = same ? null : game.push((s) => (s ? { ...s, character: { ...s.character, activeCar: v.modelId, activeCarColor: v.family ? "" : v.color } } : s)); // the screen says it is your drive now, at once
        if (!api.current.startDrive(id)) { if (op != null) game.rollback(op); return; }
        pending.current = same ? Promise.resolve(true) : call("/api/rides", { action: "use", modelId: v.modelId }).then((r) => {
          if (r.failed) { if (op != null) game.rollback(op); abort(r.error || "That vehicle could not be selected."); return false; }
          if (op != null) game.done(op); return true;
        });
      },
      async onLeave({ id, modelId, color, v }) {
        setLeaving(true); // the drive is in the vehicle's own hands until the server has agreed to it
        const ok = await (pending.current ?? Promise.resolve(true)); if (!ok) return;
        const cur = live.current.vehicles?.find((x) => String(x.id) === String(id));
        setDriveHandoff({ modelId: modelId ?? cur?.modelId ?? "", color: cur?.family ? color : (color ?? cur?.color ?? ""), v: Math.max(0, v ?? 0) });
        setTimeout(() => router.push("/map"), 380); // long enough for the screen to go dark first
      },
    };
    return () => { handlers.current = {}; };
  }, [api, handlers, router, abort]);
  useEffect(() => () => { if (!live.current.drv) clearDriveHandoff(); }, []);

  useEffect(() => { // Escape cancels a walk to a vehicle
    if (entry?.phase !== "walk") return; const k = (e) => { if (e.key === "Escape") api.current?.cancelEntry?.(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [entry?.phase, api]);

  const hold = (axis, value) => ({
    onPointerDown: (e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} api.current?.setDriveInput({ [axis]: value }); },
    onPointerUp: () => api.current?.setDriveInput({ [axis]: 0 }), onPointerCancel: () => api.current?.setDriveInput({ [axis]: 0 }), onLostPointerCapture: () => api.current?.setDriveInput({ [axis]: 0 }),
    onContextMenu: (e) => e.preventDefault(),
  });
  return <>
    {entry && !drv && <section className="hg-entry" role="status" aria-live="polite"><span>{entry.phase === "walk" ? "Walking to the vehicle…" : entry.phase === "enter" ? "Getting in…" : "Getting out…"}</span>
      {entry.phase === "walk" && <button type="button" onClick={() => api.current?.cancelEntry?.()}>Cancel</button>}</section>}
    {drv && !leaving && <>
      <section className="hg-hud" aria-live="polite"><b>{drv.speed}<small> km/h</small></b><span>{drv.hit ? "Blocked. Reverse and steer around it." : "Drive down the driveway, through the gate and out onto the main road."}</span>
        <div className="hg-hud-btns"><button type="button" onClick={() => { const r = api.current?.exitCar?.(); if (r && !r.ok) toast.error(r.why); }}>Park</button></div></section>
      <div className="hg-pad" role="group" aria-label="Driving controls. Keyboard: arrow keys or W A S D.">
        <div className="hg-steer"><button type="button" aria-label="Steer left" {...hold("steer", -1)}><Icon name="left" size={26} /></button><button type="button" aria-label="Steer right" {...hold("steer", 1)}><Icon name="right" size={26} /></button></div>
        <div className="hg-pedals"><button type="button" className="hg-brake" aria-label="Brake and reverse" {...hold("throttle", -1)}>Brake<small>Reverse</small></button><button type="button" className="hg-gas" aria-label="Accelerate" {...hold("throttle", 1)}>Go</button></div>
      </div></>}
    <RoadTransition on={leaving} />
  </>;
}