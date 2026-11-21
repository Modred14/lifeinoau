// tests/home-style.test.mjs
// The outside of a home depends on the accommodation: every type has its own building, the front door of the exterior is exactly where the interior's and the plot's footpath
// expect it, and the windows sit on real walls. (The 3D drawing itself is checked in a browser; these are the numbers it is built from.)
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js");
const P = await import("../lib/plot.js");
const S = await import("../lib/homeStyle.js");
const H = await import("../lib3d/houseShell.js");
let bad = 0;
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const HOMES = ["Awo", "Angola", "Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"];

const sigs = new Map();
for (const h of HOMES) {
  const room = R.roomFor(h, "p"), st = S.homeStyle(room), W = room.w, D = room.d, ent = H.entranceOf(room), plot = P.plotFor(room);
  sigs.set(h, [st.kind, st.storeys, st.roof, st.wall, st.roofColor].join("|"));
  chk(`${h}: has a style (${st.kind}, ${st.storeys} upper storeys, ${st.roof} roof)`, !!st.kind && st.storeys >= 0 && ["gable", "hip", "flat"].includes(st.roof));
  const len = ent.side === "S" || ent.side === "N" ? W + 0.48 : D;
  chk(`${h}: the doorway is inside its wall (a hall's door keeps the original spot at the wall's end)`, Math.abs(ent.x) + H.HOLE_W / 2 <= len / 2 + 0.05, `x=${ent.x} len=${len}`);
  const cellX = ent.cx + W / 2, cellZ = ent.cz + D / 2;
  chk(`${h}: the exterior door is on the same spot as the footpath's start (${cellX.toFixed(1)}, ${cellZ.toFixed(1)} vs ${plot.doorOut.x}, ${plot.doorOut.z})`, Math.abs(cellX - plot.doorOut.x) <= 1 && Math.abs(cellZ - plot.doorOut.z) <= 1);
  const ws = H.windowsOf(room);
  chk(`${h}: every window sits on its wall, off the corners, below the roof line`, ws.length > 0 && ws.every((w) => { const l = w.side === "N" || w.side === "S" ? W + 0.48 : D; return Math.abs(w.x) + w.w / 2 < l / 2 + 1e-6 && w.y + w.h < 3.4; }));
}
chk("every accommodation type has its own look (all signatures differ between private homes)", new Set(["Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"].map((h) => sigs.get(h))).size === 6);
chk("halls differ from private homes", !["Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"].some((h) => sigs.get(h) === sigs.get("Awo")));
chk("the big halls are taller than a small hall", S.homeStyle(R.roomFor("Angola", "p")).storeys > S.homeStyle(R.roomFor("Awo", "p")).storeys);
chk("a 4-bedroom house is a bigger building than a 3-bedroom one (more storeys or a bigger footprint)", S.homeStyle(R.roomFor("4-Bedroom House", "p")).storeys >= S.homeStyle(R.roomFor("3-Bedroom House", "p")).storeys && R.roomFor("4-Bedroom House", "p").w * R.roomFor("4-Bedroom House", "p").d > R.roomFor("3-Bedroom House", "p").w * R.roomFor("3-Bedroom House", "p").d);
chk("an unknown accommodation never throws and falls back to a hall", S.homeStyle({ hostel: "Nowhere" }).kind === "hall" && S.homeStyle(null).kind === "hall");
chk("roofs have a sensible pitch", S.ridgeRise(8, "gable") >= 1.1 && S.ridgeRise(8, "gable") <= 2.6 && S.ridgeRise(8, "flat") < 1);
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
