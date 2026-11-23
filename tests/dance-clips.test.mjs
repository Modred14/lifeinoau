// tests/dance-clips.test.mjs
// The club dance styles (lib/danceStyles.js) and their baked clips (lib3d/avatar/danceClips.js), run against the REAL installed male and female skeletons in plain Node.
// Proves: every style points at a clip that really exists, each clip is finite, loops (last frame = first) and actually moves, and Ọ̀blee is its own clip (not the groove).
// Not covered: how it LOOKS. That needs a person watching the game in a browser.
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
globalThis.self ??= globalThis; // the loader looks for a browser-style global
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const warn = console.warn, err = console.error; console.warn = console.error = () => {}; // Node cannot decode the textures; they do not matter here
const { DANCE_STYLES, danceById, isDanceId, danceAnimFor } = await import("../lib/danceStyles.js");
const { activityClips } = await import("../lib3d/avatar/activityClips.js");
const { resolveClip } = await import("../lib3d/avatar/animation.js");

chk("ids are unique and every style has a label and a clip", new Set(DANCE_STYLES.map((s) => s.id)).size === DANCE_STYLES.length && DANCE_STYLES.every((s) => s.label && s.clip));
chk("Ọ̀blee is offered and has its own clip, not the party groove", danceById("oblee")?.clip === "danceOblee" && danceById("oblee").clip !== danceById("groove").clip);
chk("only known ids are accepted", isDanceId("oblee") && !isDanceId("../etc") && !isDanceId("") && !isDanceId(null) && danceAnimFor("nope") === null);
chk("every style falls back to the party groove", DANCE_STYLES.every((s) => danceAnimFor(s.id).at(-1) === "idleEmote"));

const iconSrc = fs.readFileSync(new URL("../components/Icon.js", import.meta.url), "utf8");
chk("every dance style uses an icon that exists in the icon set", DANCE_STYLES.every((s) => new RegExp(`[{,\\s]${s.icon}\\s*:`).test(iconSrc)));
const load = (f) => new Promise((res, rej) => { const b = fs.readFileSync(f); new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "", res, rej); });
for (const [g, file] of [["F", "base_female"], ["M", "base_male"]]) {
  const gltf = await load(new URL(`../public/models/avatars/${file}.glb`, import.meta.url).pathname);
  const clips = [...gltf.animations, ...activityClips(gltf.scene, g, gltf.animations)];
  for (const s of DANCE_STYLES.filter((x) => x.id !== "groove")) {
    const c = resolveClip(clips, s.clip);
    chk(`${g}: ${s.label} resolves to a clip`, !!c);
    if (!c) continue;
    let nan = 0, gap = 0, range = 0;
    for (const tr of c.tracks) { const v = tr.values, w = tr.getValueSize(), n = v.length / w;
      for (const x of v) if (!Number.isFinite(x)) nan++;
      for (let i = 0; i < w; i++) { gap = Math.max(gap, Math.abs(v[i] - v[v.length - w + i])); let lo = 1e9, hi = -1e9; for (let k = 0; k < n; k++) { lo = Math.min(lo, v[k * w + i]); hi = Math.max(hi, v[k * w + i]); } range = Math.max(range, hi - lo); } }
    chk(`${g}: ${s.label}: finite, loops cleanly (gap ${gap.toFixed(4)}) and moves (range ${range.toFixed(2)})`, nan === 0 && gap < 1e-3 && range > 0.1);
  }
  const ob = resolveClip(clips, "danceOblee"), bo = resolveClip(clips, "danceBounce");
  chk(`${g}: Ọ̀blee moves its arms more than the bounce (a distinct choreography)`, ob.tracks.find((t) => /RightArm\.quaternion/.test(t.name)).values.some((v, i) => Math.abs(v - bo.tracks.find((t) => /RightArm\.quaternion/.test(t.name)).values[i]) > 0.1));
  const authored = [{ name: "mixamo.com|Dance_Oblee", tracks: [], duration: 1 }]; // an artist's clip, named any of the aliases
  const built = activityClips(gltf.scene, g, authored).map((c) => c.name);
  chk(`${g}: a clip the model already has under an alias is not overwritten by ours`, !built.includes("danceOblee") && built.includes("danceBounce"));
}
console.warn = warn; console.error = err;
console.log(bad ? `\n${bad} check(s) failed` : "\nAll dance checks passed"); process.exit(bad ? 1 : 0);
