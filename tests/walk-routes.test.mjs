// tests/walk-routes.test.mjs: the automatic walk to a ring (lib3d/interiors/routing.js, followed by the scene's own movement in lib3d/interiors/scene.js).
// It replays the scene's follower with the real movePlayer() in every real building: from the door to every ring, and between floors both ways.
// Before routing.js the walk only planned on the floor the character stood on, so every ring on an upper floor (195 of 579: lecture rooms, exam halls, beds,
// kitchens, libraries) could not be walked to: the character walked to the spot below it on the ground floor and the activity panel never opened.
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { classify, buildInterior } from "../lib3d/interiors/index.js";
import { activityHubs } from "../lib3d/interiors/activityHubs.js";
import { movePlayer } from "../lib3d/interiors/compile.js";
import { planRoute, stairPoint } from "../lib3d/interiors/routing.js";
import { PRESENCE, stepAllowed, nearHub } from "../lib/activities.js";
import { NEAR_METRES, nearestRing } from "../lib/buildingPanel.js";

let bad = 0; const chk = (l, c, more) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && more ? "\n     " + more : "")); };
const d = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const all = new Map(); for (const l of LANDMARKS) all.set(l.id, { id: l.id, name: l.name, kind: l.kind }); for (const p of d.places) all.set(p.id, { id: p.id, name: p.name, kind: p.kind });

const DT = 1 / 30, SPEED = 1.9;
const mk = (c, x, z, fl) => ({ x, z, fl, y: c.floorY[fl], yaw: 0 });
/** The scene's follower. Returns { ok, why, t, jump (the biggest move in one frame), samples (a position every 4 s, as ActivityLayer reports them) }. */
function follow(c, P, plan) {
  let i = 0, stuck = 0, t = 0, jump = 0, next = 4; const pts = plan.pts, samples = [];
  while (t < 600) {
    t += DT; const [tx, tz] = pts[i], dx = tx - P.x, dz = tz - P.z, dd = Math.hypot(dx, dz), step = SPEED * DT;
    if (dd < 0.12) { i++; if (i >= pts.length) return { ok: true, t, jump, samples }; continue; }
    const k = Math.min(step, dd) / dd, n = Math.max(1, Math.ceil(Math.min(step, dd) / 0.08)), sx = P.x, sz = P.z;
    for (let q = 0; q < n; q++) movePlayer(c, P, (dx * k) / n, (dz * k) / n);
    jump = Math.max(jump, Math.hypot(P.x - sx, P.z - sz));
    stuck = Math.hypot(P.x - sx, P.z - sz) < step * 0.15 ? stuck + DT : 0; if (stuck > 1.6) return { ok: false, why: `stuck at waypoint ${i}/${pts.length} (${P.x.toFixed(1)}, ${P.z.toFixed(1)}) on floor ${P.fl}`, t, jump, samples };
    if (t >= next) { samples.push({ x: P.x, z: P.z, floor: P.fl, t }); next += 4; }
  }
  return { ok: false, why: "never arrived", t, jump, samples };
}

let buildings = 0, rings = 0, upper = 0, reached = 0, cross = 0, crossOk = 0, maxJump = 0, rejected = 0, noRoute = 0; const fails = [], rejects = [];
for (const p of all.values()) {
  const cl = classify(p.id, p.kind); if (cl.mode !== "interior") continue; const c = buildInterior(p), { hubs } = activityHubs(c, cl.spec); buildings++;
  const sp = c.spawn;
  const check = (label, from, h) => {
    const plan = planRoute(c, { x: from.x, z: from.z, fl: from.fl }, h.x, h.z, h.floor);
    if (!plan) { noRoute++; fails.push(`${label}: no route`); return false; }
    const P = { ...from }, r = follow(c, P, plan); maxJump = Math.max(maxJump, r.jump);
    const there = r.ok && P.fl === h.floor && nearHub({ x: P.x, z: P.z, floor: P.fl }, h, 0.5) && Math.hypot(P.x - h.x, P.z - h.z) <= NEAR_METRES;
    if (!there) { fails.push(`${label}: ${r.ok ? `ended at (${P.x.toFixed(1)}, ${P.z.toFixed(1)}) on floor ${P.fl}` : r.why}`); return false; }
    // what the server would say to the position reports sent on the way (it checks the spot is standable on that floor, and reachable at walking pace)
    let prev = { x: from.x, z: from.z, at: 0 };
    for (const s of r.samples) { const nv = c.navPlayer[s.floor], sn = nv.snap(s.x, s.z), standable = sn && Math.hypot(s.x - sn[0], s.z - sn[1]) <= 0.6, paced = stepAllowed(prev, { x: s.x, z: s.z }, s.t * 1000);
      if (!standable || !paced) { rejected++; rejects.push(`${label} at ${s.t.toFixed(0)}s: ${!standable ? "not standable" : "too fast"}`); break; } prev = { x: s.x, z: s.z, at: s.t * 1000 }; }
    return true;
  };
  for (const h of hubs) { rings++; if (h.floor > 0) upper++; if (check(`${p.id} ${h.id} (floor ${h.floor}) from the door`, mk(c, sp.x, sp.z, 0), h)) reached++; }
  const lo = hubs.filter((h) => h.floor === 0), hi = hubs.filter((h) => h.floor === 1);
  for (const [A, B] of [[lo[0], hi[0]], [hi[0], lo[0]], [hi.at(-1), lo.at(-1)]]) { if (!A || !B) continue; cross++; if (check(`${p.id} ${A.id} -> ${B.id}`, mk(c, A.x, A.z, A.floor), B)) crossOk++; }
}
chk(`every ring in ${buildings} buildings can be walked to from the door (${reached} of ${rings}, ${upper} of them on an upper floor)`, reached === rings && rings > 500 && upper > 150, fails.slice(0, 5).join("\n     "));
chk(`walking between floors works both ways (${crossOk} of ${cross} walks)`, crossOk === cross && cross > 100, fails.slice(0, 3).join("\n     "));
chk(`the character never teleports: the biggest move in one frame is ${maxJump.toFixed(3)} m (walking speed allows ${(SPEED * DT).toFixed(3)} m)`, maxJump <= SPEED * DT * 1.05);
chk(`position reports sent along every walk (every 4 s, stairs included) are accepted by the server's rules (${rejected} rejected)`, rejected === 0, rejects.slice(0, 4).join("\n     "));

// ---- the cases that must not work, and the ones that must not change
const sci = buildInterior(all.get("f_science")), sp = sci.spawn, from = { x: sp.x, z: sp.z, fl: 0 };
chk("a floor the building does not have gives no route", planRoute(sci, from, 5, 5, 2) === null && planRoute(sci, from, 5, 5, -1) === null);
chk("a position that is not a number gives no route", planRoute(sci, from, NaN, 5, 0) === null && planRoute(sci, { ...from, x: NaN }, 5, 5, 0) === null);
{ const one = [...all.values()].map((p) => ({ p, cl: classify(p.id, p.kind) })).find((x) => x.cl.mode === "interior" && buildInterior(x.p).floors === 1); const c1 = buildInterior(one.p);
  chk(`a one-floor building (${one.p.id}) has no way to an upper floor`, planRoute(c1, { x: c1.spawn.x, z: c1.spawn.z, fl: 0 }, c1.spawn.x, c1.spawn.z, 1) === null); }
{ const a = planRoute(sci, from, 10, 12, 0), b = planRoute(sci, from, 10, 12); chk("no floor given means the floor you are on, exactly as before", a && b && JSON.stringify(a) === JSON.stringify(b)); }
{ const noStairs = { ...sci, stairs: [] }; chk("another floor with the stairs missing is unreachable, not a walk that never ends", planRoute(noStairs, from, 5, 12, 1) === null); }
{ const s = sci.stairs[0], a = stairPoint(s, 0), b = stairPoint(s, 1); chk("stairPoint runs from the bottom end to the top end of the ramp", Math.hypot(a[0] - b[0], a[1] - b[1]) > 5 && s.dz === 1 && a[1] < b[1]); }
// the panel picks the ring with the shortest real route, and for an upstairs ring that route includes the stairs
{ const upstairs = activityHubs(sci, classify("f_science", "").spec).hubs.filter((h) => h.floor === 1), straight = (h) => Math.hypot(h.x - sp.x, h.z - sp.z);
  const r = nearestRing(upstairs, (h) => { const p = planRoute(sci, from, h.x, h.z, h.floor); return p && { length: p.length, speed: SPEED }; }, { x: sp.x, z: sp.z, floor: 0 });
  chk("the panel's nearest upstairs ring counts the real walk up the stairs, not the straight line", upstairs.length > 0 && r && r.ring.floor === 1 && r.metres > straight(r.ring) && r.seconds >= 1, JSON.stringify(r && { metres: r.metres, straight: straight(r.ring) })); }

console.log(bad ? `\n${bad} check(s) failed` : "\nAll walks reach their ring"); process.exit(bad ? 1 : 0);
