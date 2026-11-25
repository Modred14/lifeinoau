// components/RoadTransition.js
// A brief full-screen dark screen with "Entering Main Road…". The home screen fades it in when the vehicle leaves the gate; the map page shows it from its very first frame
// (`on` already true when it mounts, so there is no flash of the map) and fades it out once the vehicle is on the road.
"use client";
import "./road-transition.css";

// With `snap` (the home screen's last frame, lib/driveHandoff.js) there is no dark screen and no words: the frame the player was looking at simply stays until the map's own first frame is ready, then
// fades away (a short cross-fade), so the street arrives as a continuation. Without one (a missing frame, a browser that refused it) the dark "Entering Main Road…" screen is the fallback.
export default function RoadTransition({ on, snap = "" }) {
  if (snap) return <div className="road-tr road-tr-snap" data-on={on ? "1" : undefined} aria-hidden="true"><img src={snap} alt="" draggable={false} /></div>;
  return <div className="road-tr" data-on={on ? "1" : undefined} role="status" aria-live="polite" aria-hidden={on ? undefined : "true"}><b>Entering Main Road…</b><i aria-hidden="true" /></div>;
}