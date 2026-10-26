// components/RoadTransition.js
// A brief full-screen dark screen with "Entering Main Road…". The home screen fades it in when the vehicle leaves the gate; the map page shows it from its very first frame
// (`on` already true when it mounts, so there is no flash of the map) and fades it out once the vehicle is on the road.
"use client";
import "./road-transition.css";

export default function RoadTransition({ on }) {
  return <div className="rt" data-on={on ? "1" : undefined} role="status" aria-live="polite" aria-hidden={on ? undefined : "true"}><b>Entering Main Road…</b><i aria-hidden="true" /></div>;
}
