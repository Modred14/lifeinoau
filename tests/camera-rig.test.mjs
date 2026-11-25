// tests/camera-rig.test.mjs — the shared camera maths (lib3d/camera/cameraRig.js) and its use in the interior scene.
import { CAMERA_CONFIG as C, sweepClear, stepClearance, blockedPitch, hysteresis, fovFor, damp } from "../lib3d/camera/cameraRig.js";
import { rayClip } from "../lib3d/interiors/compile.js";
import { readFileSync } from "node:fs";
let bad = 0; const chk = (n, ok) => { console.log((ok ? "OK   " : "FAIL ") + n); if (!ok) bad++; };
const I = C.interior;

// a wall 1 m behind the player (player at 0,0 looking +z, camera wanted at z = -3)
const wall = [{ x0: -5, x1: 5, z0: -1.4, z1: -1.2 }], clip = (ax, az, bx, bz, pad) => rayClip(wall, ax, az, bx, bz, pad);
const f = sweepClear(clip, 0, 0, 0, -3, I.pad, I.side);
chk("a wall behind the player shortens the camera run", f < 0.4 && f > 0);

// a corner the centre ray slips past: a narrow pillar just beside the centre line
const pillar = [{ x0: 0.2, x1: 0.6, z0: -2, z1: -1.6 }], clip2 = (ax, az, bx, bz, pad) => rayClip(pillar, ax, az, bx, bz, pad);
chk("the centre ray alone misses the pillar", clip2(0, 0, 0, -3, 0) === 1);
chk("the side rays catch it", sweepClear(clip2, 0, 0, 0, -3, I.pad, I.side) < 1);
chk("no obstacle: fully clear", sweepClear(() => 1, 0, 0, 0, -3, I.pad, I.side) === 1);
chk("zero-length run is clear (no NaN)", sweepClear(clip, 0, 0, 0, 0, I.pad, I.side) === 1);

// smoothing: in fast and never beyond the target; out slowly, and only after the hold
let s = { v: 1, hold: 0 }; stepClearance(s, 0.3, 1 / 60); chk("pulls in within a frame or two, never past the target", s.v < 1 && s.v >= 0.3);
for (let i = 0; i < 30; i++) stepClearance(s, 0.3, 1 / 60); chk("settles on the obstruction", Math.abs(s.v - 0.3) < 0.01);
const before = s.v; for (let i = 0; i < 10; i++) stepClearance(s, 1, 1 / 60); chk("holds still while the view has only just cleared (no pumping)", s.v === before);
for (let i = 0; i < 300; i++) stepClearance(s, 1, 1 / 60); chk("then eases fully back out", s.v > 0.99);
const flick = { v: 1, hold: 0 }; let maxJump = 0, prev = 1;
for (let i = 0; i < 600; i++) { stepClearance(flick, i % 12 < 6 ? 0.4 : 1, 1 / 60); maxJump = Math.max(maxJump, Math.abs(flick.v - prev)); prev = flick.v; }
chk("an obstacle flickering on and off does not make the camera zoom in and out", flick.v < 0.5);
chk("never below the minimum fraction (cannot sit in the player)", stepClearance({ v: 1, hold: 0 }, 0, 10).v >= I.minFrac);
chk("a NaN target is treated as clear", stepClearance({ v: 0.5, hold: 9 }, NaN, 0.1).v >= 0.5);

// walled in: the camera rises over the player instead of collapsing
chk("no obstruction leaves the pitch alone", blockedPitch(0.4, 1) === 0.4);
chk("walled in tilts the pitch up", blockedPitch(0.4, I.minFrac) > 1.1);
chk("already steeper pitch is never lowered", blockedPitch(1.2, 0.3) >= 1.2);

// hysteresis
let vis = true; vis = hysteresis(vis, 0.8, I.hideBelow, I.showAbove); chk("stays visible between the thresholds", vis === true);
vis = hysteresis(vis, 0.5, I.hideBelow, I.showAbove); vis = hysteresis(vis, 0.8, I.hideBelow, I.showAbove); chk("stays hidden between the thresholds", vis === false);
chk("shows again above the upper threshold", hysteresis(false, 1, I.hideBelow, I.showAbove) === true);

// device framing
chk("phone held upright gets a wider field of view", fovFor(0.5) > fovFor(1.6));
chk("ultrawide is narrower than normal landscape", fovFor(2.4) < fovFor(1.6));
chk("a bad aspect (0 / NaN) falls back to the default", fovFor(0) === I.fov.landscape && fovFor(NaN) === I.fov.landscape);

// time-based smoothing gives the same result however the time is sliced
let a = 0, b = 0; for (let i = 0; i < 60; i++) a = damp(a, 1, 5, 1 / 60); for (let i = 0; i < 30; i++) b = damp(b, 1, 5, 1 / 30);
chk("damping is frame-rate independent", Math.abs(a - b) < 1e-9);

// wiring
const src = readFileSync(new URL("../lib3d/interiors/scene.js", import.meta.url), "utf8");
chk("the interior scene uses the sweep, not a single ray", /sweepClear\(/.test(src) && !/rayClip\(\s*c\.wallsByFloor\[P\.fl\],\s*P\.x,\s*P\.z,\s*P\.x - fx/.test(src));
chk("the interior camera no longer eases with a frame-based lerp", !/camera\.position\.lerp\(camPos, Math\.min\(1, dt \* 14\)\)/.test(src));
chk("the interior field of view is not a fixed 62", !/camera\.fov = view === "overhead" \? 45 : 62/.test(src));
process.exit(bad ? 1 : 0);
