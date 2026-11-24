// Bundled by tests/e2e/vehicle-controls.e2e.mjs. Mounts the game's REAL TripHud (+ CSS) with the plain `input` object the map page gives it, and reads it every animation
// frame through the REAL keyboard binding and reader (lib3d/vehicleInput.js), exactly as lib3d/travel.js does. The test reads window.__frames, the last reader output.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TripHud from "@/components/TripHud";
import "@/src/app/globals.css";
import "@/components/bottom-nav.css";
import { attachVehicleKeys, createVehicleReader } from "@/lib3d/vehicleInput.js";

const input = (window.__input = {});
const base = { phase: "drive", speed: 0, gear: "D", remain: 400, eta: 120, free: true, canFly: false, airborne: false, alt: 0, canExit: true, exiting: false };
let setStRef = null;
window.__setSt = (p) => setStRef && setStRef((s) => ({ ...s, ...p }));
const refs = { mini: { current: null }, prev: { current: null } };
let renders = 0; window.__renders = () => renders;

function App() {
  const [st, setSt] = useState(base); setStRef = setSt; renders++;
  return <TripHud trip={{ mode: "car", driver: false, name: "Test" }} placeName="Test place" st={st} input={input} miniRef={refs.mini} previewRef={refs.prev} onCancel={() => {}} />;
}
document.body.dataset.nav = "on";
createRoot(document.getElementById("root")).render(<App />);

const vin = attachVehicleKeys(), reader = createVehicleReader({ vin, input });
window.__driving = true; window.__last = null; window.__exitKeyHits = 0;
let t = performance.now();
const loop = (now) => { const dt = Math.min(0.05, (now - t) / 1000); t = now; window.__last = reader.read(window.__driving, dt); if (vin.take("act")) window.__exitKeyHits++; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
window.__ready = true;
