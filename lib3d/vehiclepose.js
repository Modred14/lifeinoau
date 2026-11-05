// lib3d/vehiclepose.js
// How a driven vehicle sits on the road: its height, pitch and roll from where its tyres really touch the surface. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// The old way tilted the whole model about the middle of the car by the slope of the road 2 m ahead and behind, and added the body's lean under braking and in corners to the SAME rotation. So
// the tyres left the road whenever the body leaned, and the slope read as nonsense wherever the sample point was not on the carriageway. Here:
//   - the contacts are the real wheel positions of the model (axles and track, from its wheel pivots), carried to the world by the car's pose;
//   - the road height under each comes from graph.heightNear (continuous, never 0 just because a tyre is over an edge);
//   - the ride (y, pitch, roll) is the plane through those contacts, lifted so that no tyre is below the road. Both axles always touch the road, on a slope, a crest and a dip;
//   - the body's own lean (carphysics pitch and roll) is a SEPARATE rotation of the body alone, about the tyres' ground level (lib3d/suspension.js), so it never lifts a tyre;
//   - a limit on how fast the ride may change is only a safety net against a bad sample (it is far above anything the road does).
// Frame: model x = left, z = forward (the nose), y up; the wheels' lowest point is at y = 0. Pitch is + nose up, roll is + left side up.
import { carMaskAt } from "./roadgraph.js";

/** The wheel contacts [{ x, z, r }] of a vehicle model (the pivots its wheels hang on, in the model's own frame). */
export function wheelContacts(vehicle) {
  const out = []; for (const w of vehicle?.wheels ?? []) { const p = w.parent?.position; if (p) out.push({ x: p.x, z: p.z, r: w.userData?.r ?? p.y ?? 0.3 }); }
  return out;
}
/** Contacts for a vehicle only known by its size: two axles on the middle line of its length, a track a little narrower than its width. */
export function defaultContacts(len = 4.6, wid = 1.8, wheelbase = len * 0.58, zMid = 0) {
  const t = (wid - 0.25) / 2, f = zMid + wheelbase / 2, r = zMid - wheelbase / 2; return [{ x: -t, z: f }, { x: t, z: f }, { x: -t, z: r }, { x: t, z: r }];
}
/** Axle half-lengths and track of a contact set, for limiting how far a body may lean without touching its tyres. */
export function stance(contacts) {
  let zf = -Infinity, zr = Infinity, xm = 0; for (const c of contacts) { zf = Math.max(zf, c.z); zr = Math.min(zr, c.z); xm = Math.max(xm, Math.abs(c.x)); }
  return { wheelbase: contacts.length ? zf - zr : 2.7, halfTrack: xm || 0.8 };
}

/**
 * The ride that puts every tyre on the road. `heights[i]` is the road height under contact i. Least-squares plane y = y0 + a*z + b*x through them (exact when they are coplanar, which a flat or
 * planar road is), then y0 lifted so that the LOWEST margin is zero: no tyre is ever below the road, whatever the surface does. Returns { y, pitch, roll } (y at the model's origin).
 */
export function solveRide(contacts, heights, out = {}) {
  const n = contacts.length; if (!n) { out.y = 0; out.pitch = 0; out.roll = 0; return out; }
  let sz = 0, sx = 0, sy = 0, szz = 0, sxx = 0, szx = 0, szy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const { x, z } = contacts[i], h = heights[i]; sz += z; sx += x; sy += h; szz += z * z; sxx += x * x; szx += z * x; szy += z * h; sxy += x * h; }
  // normal equations of  h = y0 + a z + b x
  const m = [[n, sz, sx, sy], [sz, szz, szx, szy], [sx, szx, sxx, sxy]];
  let a = 0, b = 0, y0 = sy / n;
  const det = n * (szz * sxx - szx * szx) - sz * (sz * sxx - szx * sx) + sx * (sz * szx - szz * sx);
  if (Math.abs(det) > 1e-9) {
    const d = (c) => { const q = m.map((r) => r.slice()); for (let i = 0; i < 3; i++) q[i][c] = m[i][3]; return q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]); };
    y0 = d(0) / det; a = d(1) / det; b = d(2) / det;
  } else if (n >= 2) {   // all contacts on a line (or one): only the slope along it is known
    let zmin = Infinity, zmax = -Infinity, hmin = 0, hmax = 0; for (let i = 0; i < n; i++) { if (contacts[i].z < zmin) { zmin = contacts[i].z; hmin = heights[i]; } if (contacts[i].z > zmax) { zmax = contacts[i].z; hmax = heights[i]; } }
    if (zmax - zmin > 1e-6) a = (hmax - hmin) / (zmax - zmin);
  }
  const pitch = Math.atan(a), roll = Math.atan(b), sp = Math.sin(pitch), sr = Math.sin(roll), cp = Math.cos(pitch);
  // where each tyre's lowest point is with this tilt (root rotation order YXZ: the model's y component of (x, 0, z) is z sin(pitch) + x sin(roll) cos(pitch)); the root goes up until none is below the road
  let lift = -Infinity; for (let i = 0; i < n; i++) { const { x, z } = contacts[i]; lift = Math.max(lift, heights[i] - (z * sp + x * sr * cp)); }
  out.y = lift; out.pitch = pitch; out.roll = roll; return out;
}

const slew = (prev, next, max) => (next > prev + max ? prev + max : next < prev - max ? prev - max : next);

/**
 * Follows the road for one vehicle. update(car, dt) reads car { x, z, hx, hz, lv, h, v } and writes car.road = { y, pitch, roll } plus car.h (the road height under the model's origin, what the
 * rest of the game reads) and car.slope (the road's pitch). reset(car) puts it straight on the road with no easing (a new car, a teleport).
 */
export function createRoadFollower(graph, contacts) {
  const C = contacts.length ? contacts : defaultContacts(), hs = new Array(C.length).fill(0), R = {}, tmp = {};
  const sample = (car, mask, hRef) => {
    for (let i = 0; i < C.length; i++) { const c = C[i]; hs[i] = graph.heightNear(car.x + car.hx * c.z + car.hz * c.x, car.z + car.hz * c.z - car.hx * c.x, mask, hRef); }
    return solveRide(C, hs, R);
  };
  return {
    contacts: C,
    reset(car) {
      const mask = carMaskAt(car.lv ?? 0, car.h ?? 0), here = graph.surfaceAt(car.x, car.z, tmp, mask, NaN), h0 = here.cls === 1 ? here.h : 0;
      const r = sample(car, mask, h0); car.road = { y: r.y, pitch: r.pitch, roll: r.roll }; car.h = r.y; car.slope = r.pitch; return car.road;
    },
    update(car, dt = 1 / 60) {
      if (!car.road) return this.reset(car);
      const mask = carMaskAt(car.lv ?? 0, car.h), r = sample(car, mask, car.h), road = car.road, sp = Math.abs(car.v ?? 0);
      // the safety net: the ride may change no faster than a car could climb the steepest road here (and a little more), and tilt no faster than its crests allow
      const dy = (sp * 0.3 + 1.0) * dt, da = 0.7 * dt;
      road.y = slew(road.y, r.y, dy); road.pitch = slew(road.pitch, r.pitch, da); road.roll = slew(road.roll, r.roll, da);
      car.h = road.y; car.slope = road.pitch; return road;
    },
  };
}
