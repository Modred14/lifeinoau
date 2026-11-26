// tests/home-clips.test.mjs
// The home animations (lib3d/avatar/homeClips.js) bake on the real male and female avatar skeletons, loop, move the body, and the seated and floor poses put the hips where a seat / the floor is.
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { activityClips } from "../lib3d/avatar/activityClips.js";
import { resolveClip } from "../lib3d/avatar/animation.js";
globalThis.self = globalThis;
let bad = 0; const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const NAMES = ["cook", "shower", "washHands", "brushTeeth", "watchTV", "sitRelax", "sitPhone", "meditate"];
for (const [g, file] of [["M", "base_male.glb"], ["F", "base_female.glb"]]) {
  const buf = fs.readFileSync(new URL(`../public/models/avatars/${file}`, import.meta.url)), gltf = await new Promise((ok, no) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", ok, no));
  const root = gltf.scene; root.updateMatrixWorld(true);
  const clips = [...gltf.animations]; clips.push(...activityClips(root, g, clips));
  const hipsOf = (clip) => { const tr = clip.tracks.find((t) => /Hips\.position$/.test(t.name)); return tr ? tr.values : null; };
  for (const n of NAMES) {
    const c = resolveClip(clips, n); chk(`${g} ${n}: the clip exists`, !!c); if (!c) continue;
    chk(`${g} ${n}: it has a duration and moves bones (${c.tracks.length} tracks, ${c.duration.toFixed(1)}s)`, c.duration > 0.5 && c.tracks.length > 8);
    const finite = c.tracks.every((t) => Array.from(t.values).every(Number.isFinite)); chk(`${g} ${n}: every value is a number`, finite);
    const loops = c.tracks.filter((t) => t.name.endsWith(".quaternion")).every((t) => { const v = t.values, k = 4, a = v.slice(0, k), b = v.slice(v.length - k); const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return dot > 0.995; });
    chk(`${g} ${n}: it loops (last pose = first pose)`, loops);
  }
  // seated clips: the hips sit lower than standing; meditate lower still
  const stand = new THREE.Vector3(); root.traverse((o) => { if (o.isBone && o.name.endsWith("Hips")) o.getWorldPosition(stand); });
  const low = (n) => { const v = hipsOf(resolveClip(clips, n)); return v ? Math.min(...Array.from(v).filter((_, i) => i % 3 === 1)) : null; }, high = (n) => { const v = hipsOf(resolveClip(clips, n)); return v ? Math.max(...Array.from(v).filter((_, i) => i % 3 === 1)) : null; };
  const sit = high("sitRelax"), med = high("meditate"), cook = high("cook");
  console.log(`   ${g}: hips y  standing(cook) ${cook?.toFixed(3)}  seated ${sit?.toFixed(3)}  floor ${med?.toFixed(3)}  (world standing ${stand.y.toFixed(2)} m)`);
  chk(`${g} sitting lowers the hips under a standing pose`, sit != null && cook != null && sit < cook - 0.05);
  chk(`${g} sitting on the floor lowers them further than a chair`, med != null && sit != null && med < sit - 0.05);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
