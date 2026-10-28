// tests/trip-camera-regressions.test.mjs
// Regressions found by running the map and the compound in a headless browser.
import { seatOf, KINDS } from "../lib3d/trafficsim.js";
import { createKeys } from "../lib3d/tripkeys.js";
import { readFileSync } from "node:fs";
let bad = 0; const chk = (n, ok) => { console.log((ok ? "OK   " : "FAIL ") + n); if (!ok) bad++; };
chk("a trek has no vehicle kind: its seat lookup must not throw (it threw every frame and froze the camera)", (() => { try { return !!seatOf(undefined).y && seatOf("keke") === KINDS.keke.seat; } catch { return false; } })());
const ev = (code, target = {}) => ({ code, key: code.slice(-1).toLowerCase(), target, metaKey: false, ctrlKey: false, altKey: false });
const k = createKeys(); k.press(ev("KeyW")); chk("W is read from its place on the keyboard", k.read().up === 1);
const box = { closest: (s) => (s.includes("input") ? {} : null) }; const k2 = createKeys(); k2.press(ev("KeyW", box)); chk("typing in a box never drives", k2.read().up === 0);
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
chk("the compound's keys go through tripkeys (no raw e.key map)", /createKeys/.test(src("../lib3d/compoundFleet.js")) && !/KEYMAP/.test(src("../lib3d/compoundFleet.js")));
chk("a pointer-up in the room never re-enables the orbit controls while driving", /if \(!fleet\.isDriving\(\)\) controls\.enabled = true/.test(src("../lib3d/room.js")));
chk("the stage keeps its controls off while a caller drives the camera", /if \(manual\) \{ if \(controls\.enabled\) controls\.enabled = false/.test(src("../lib3d/stage.js")));
process.exit(bad ? 1 : 0);
