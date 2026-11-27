// Nothing the shop sells may render as a solid black shape: no plain, untextured, opaque material is darker than MIN_L once a model is built.
// (Root cause: near-black albedo + ACES tone mapping = a flat black hole on big TVs, speakers and sofas. See liftBlack in lib3d/furnitureModels.js.)
const ctx = new Proxy(function () {}, { get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient" ? () => ctx : ctx), apply: () => ctx, set: () => true });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };
const THREE = await import("three");
const { buildFurniture, FURNITURE_MODEL_KEYS, MIN_L } = await import("../lib3d/furnitureModels.js");
let fails = 0; const chk = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : " -> " + extra}`); if (!ok) { fails++; process.exitCode = 1; } };
const hsl = { h: 0, s: 0, l: 0 }, bad = [];
for (const key of FURNITURE_MODEL_KEYS) {
  const g = buildFurniture(key);
  g.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (!m.color || m.map || m.emissiveMap || m.transparent || (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0)) continue; m.color.getHSL(hsl, THREE.SRGBColorSpace); if (hsl.l < MIN_L - 0.001) bad.push(`${key}:${m.color.getHexString()}`); } });
}
chk(`all ${FURNITURE_MODEL_KEYS.length} furniture models: no plain opaque material is near-black`, bad.length === 0, [...new Set(bad)].slice(0, 8).join(" "));
const tv = buildFurniture("large_smart_tv"), frame = tv.children.find((c) => c.children?.length); // the frame carries the screen
chk("the 75-inch TV frame is lifted to charcoal but keeps its screen emissive", frame && frame.material.color.getHSL({}, THREE.SRGBColorSpace).l >= MIN_L - 0.001 && frame.children[0].material.emissiveIntensity > 0);
const sp = buildFurniture("speakers"); let spL = 1; sp.traverse((o) => { if (o.isMesh && o.geometry.type === "BoxGeometry") spL = Math.min(spL, o.material.color.getHSL({}, THREE.SRGBColorSpace).l); });
chk("hi-fi speaker cabinets are no longer black", spL >= MIN_L - 0.001, String(spL));
console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
