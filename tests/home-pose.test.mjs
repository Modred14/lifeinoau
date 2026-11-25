// tests/home-pose.test.mjs
// The exact pose the home screen ends on (lib/driveHandoff.js `pose`, in the compound's cells) becomes the map's start place: poseOnSite turns it into metres on the real lot (and
// refuses what cannot be trusted: not numbers, off the lot, inside the house), and the trip flow puts the walker there, free, with no walk out of the door. Run for a hall and every private home.
import fs from "node:fs";
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js");
const { withExtras } = await import("../lib3d/mapExtras.js");
const { buildServices } = await import("../lib3d/worldsvc.js");
const { planTrip } = await import("../lib3d/tripplan.js");
const { createTripFlow } = await import("../lib3d/tripflow.js");
const { createTrafficSim } = await import("../lib3d/trafficsim.js");
const { homeLot, lotShape } = await import("../lib3d/homeLot.js");
const { homeSite, homePortal, homeBuilding, addSiteCollision, removeSiteCollision, poseOnSite, cellsPose } = await import("../lib3d/homeSite.js");
const { HOME_PLACE } = await import("../lib/travel.js");
const { setDriveHandoff, takeDriveHandoff, cleanPose, dropUncommittedHandoff, peekDriveHandoff, cleanSnap } = await import("../lib/driveHandoff.js");

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json")), places = svc.data.places;
let bad = 0, seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };

// the hand-over itself
setDriveHandoff({ walk: true, pose: { cx: 3, cz: 4, hx: 0, hz: 2 } });
const got = takeDriveHandoff();
chk("the handoff carries the pose, with the heading made a unit vector", got?.pose?.cx === 3 && got.pose.cz === 4 && Math.abs(got.pose.hz - 1) < 1e-9 && got.pose.hx === 0);
chk("a pose that is not numbers, or has no heading, is dropped", cleanPose({ cx: NaN, cz: 1, hx: 0, hz: 1 }) === null && cleanPose({ cx: 1, cz: 1, hx: 0, hz: 0 }) === null && cleanPose(null) === null && cleanPose({ cx: "1", cz: 1, hx: 0, hz: 1 }) === null);
chk("a handoff without a pose has none (the doorstep / gate fallback)", (setDriveHandoff({ walk: true }), takeDriveHandoff().pose === null));

// the home screen unmounting as the route changes must not wipe a handoff that is on its way (this wiped every walk-out in the real app), but must drop one that was only prepared
setDriveHandoff({ walk: true, go: true }); dropUncommittedHandoff();
chk("a handoff that is on its way to the map survives the home screen going away", !!peekDriveHandoff() && takeDriveHandoff().walk === true);
setDriveHandoff({ walk: true }); dropUncommittedHandoff();
chk("a handoff that was only prepared is dropped when the home screen goes away", peekDriveHandoff() === null);
chk("only a small image data URL is kept as the snapshot", cleanSnap("data:image/jpeg;base64,AAAA") !== "" && cleanSnap("http://x/y.jpg") === "" && cleanSnap("data:text/html;base64,AAAA") === "" && cleanSnap("data:image/jpeg;base64," + "A".repeat(800000)) === "" && cleanSnap(null) === "");

for (const hostel of ["Awo", "Ojaja", "Off-campus", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"].filter((h) => !process.env.ONLY || h === process.env.ONLY)) {
  const room = R.roomFor(hostel, "p"), place = places.find((p) => p.id === (HOME_PLACE[hostel] ?? "senate")), tag = hostel.padEnd(16);
  const lot = homeLot(svc, room, place, "pose"), site = homeSite(room, [], [], lot), portal = homePortal(room, site), { P } = lotShape(room), pl = P.plot;
  // a spot on the front lawn, beside the footpath, facing the street
  const cx = pl.x0 + 3, cz = pl.z1 - 3, pose = { cx, cz, hx: 0, hz: 1 }, w = poseOnSite(site, pose);
  const back = w && site.toCell(w.x, w.z);
  chk(`${tag} a lawn pose becomes a place on the map that maps back to the same cell`, !!w && Math.hypot(back[0] - cx, back[1] - cz) < 1e-6, JSON.stringify(w));
  const rt = w && cellsPose(site, w), want = Math.atan2(pose.hx, pose.hz);
  chk(`${tag} a map pose turns back into the compound's own cells and heading (what is saved when a car is left)`, !!rt && Math.hypot(rt.x - cx, rt.z - cz) < 1e-6 && Math.abs(Math.atan2(Math.sin(rt.yaw - want), Math.cos(rt.yaw - want))) < 1e-6, JSON.stringify(rt));
  const out = site.dirOf(0, 1); chk(`${tag} and the heading follows the lot's own orientation`, !!w && Math.hypot(w.hx - out[0], w.hz - out[1]) < 1e-6 && Math.abs(Math.hypot(w.hx, w.hz) - 1) < 1e-6);
  chk(`${tag} the middle of the house is refused for a person`, poseOnSite(site, { cx: room.w / 2, cz: room.d / 2, hx: 0, hz: 1 }) === null);
  chk(`${tag} a place off the lot is refused for a person, and a pose with a missing number is refused`, poseOnSite(site, { cx: pl.x0 - 5, cz: pl.z0 - 5, hx: 0, hz: 1 }) === null && poseOnSite(site, { cx: 1, cz: 1, hx: 0 }) === null && poseOnSite(site, null) === null);
  const carOut = { cx: (P.gate.x0 + P.gate.x1) / 2, cz: P.road.z0 + 1, hx: 0, hz: 1 };
  chk(`${tag} a car that has just left the gate may be on the carriageway, a person may not`, !!poseOnSite(site, carOut, { car: true }) && poseOnSite(site, carOut) === null);

  addSiteCollision(svc.world, site);
  const base = planTrip(svc, { from: place, to: place, mode: "trek", driver: false });
  const plan = { ...base, B: homeBuilding(site, portal), goal: { x: portal.exit.x, z: portal.exit.z }, start: { x: portal.exit.x, z: portal.exit.z } };
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => place, rnd }); let end = null;
  const flow = createTripFlow({ svc, sim }, { plan, free: true, drivable: site.drivable, roam: portal, roamPose: w, rnd, onArrive: () => true, onEnter() {}, onEnd: (x) => { end = x; }, onNotice() {} });
  const wk = flow.walker;
  chk(`${tag} the trip starts on foot, free, at exactly that spot, facing that way, at time zero (no walk out of the door)`, flow.state.phase === "roam" && flow.state.t === 0 && Math.hypot(wk.x - w.x, wk.z - w.z) < 1e-9 && Math.hypot(wk.hx - w.hx, wk.hz - w.hz) < 1e-6 && flow.person.visible !== false && flow.free);
  for (let i = 0; i < 30; i++) { flow.update(1 / 30, {}); sim.update(1 / 30); }
  chk(`${tag} and stays there when nobody touches the controls, the door is shut and the trip has not ended`, Math.hypot(wk.x - w.x, wk.z - w.z) < 0.05 && flow.state.door === "closed" && !end);
  let moved = 0; for (let i = 0; i < 60; i++) { flow.update(1 / 30, { dx: w.hx, dz: w.hz, mag: 1 }); sim.update(1 / 30); } moved = Math.hypot(wk.x - w.x, wk.z - w.z);
  chk(`${tag} and walks on from there when the stick is pushed (${moved.toFixed(1)} m in 2 s)`, moved > 1.2 && flow.state.phase === "roam");
  flow.dispose(); removeSiteCollision(svc.world);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
