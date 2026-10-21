// tests/avatar-pipeline.test.mjs
// The avatar pipeline end to end, in plain Node (no browser): the look rules the server and every screen share, the installed models (every selectable look has real files
// whose skeletons fit), and the real loader (lib3d/avatar/loadAvatar.js) run against those files with a stand-in `fetch`, including a dropped connection, a missing file and a
// host that refuses HEAD. What it proves: the same saved look always builds the same character, a bad network never leaves a player in a different body for the rest of the
// session, and a model that is really missing falls back to the built-in character in the SAME look.
// Not covered here: drawing in a real browser (touch input, GPU load, camera framing on phones and desktops). That still needs a hands-on pass on both kinds of device.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

const { SKIN_TONES, COLORS, HAIR, OUTFITS, ACCESSORIES, cleanLook, defaultLook, lookKey } = await import("../lib/look.js");
const lib3dLook = await import("../lib3d/look.js");
const { BASES, REQUIRED_BONES, REQUIRED_SLOTS, partUrl, boneKey } = await import("../lib3d/avatar/manifest.js");
const { npcSpec } = await import("../lib3d/avatar/npc.js");

// ---------- 1. the look rules ----------
chk("there is one look module: lib3d/look.js only re-exports lib/look.js", lib3dLook.HAIR === HAIR && lib3dLook.cleanLook === cleanLook && lib3dLook.lookKey === lookKey);
for (const g of ["M", "F"]) {
  const d = defaultLook(g);
  chk(`${g}: the default look is already valid (cleaning it changes nothing)`, JSON.stringify(cleanLook(d, g)) === JSON.stringify(d));
  chk(`${g}: junk, null and a wrong type all become the default look`, [null, undefined, 7, "x", [], {}].every((v) => JSON.stringify(cleanLook(v, g)) === JSON.stringify(d)));
  let idem = true, all = 0;
  for (const hair of HAIR[g]) for (const outfit of OUTFITS) for (const skin of Object.keys(SKIN_TONES)) {
    const l = { skin, hair, outfit, top: "red", bottom: "grey", build: "athletic", height: "tall", acc: ACCESSORIES[g].slice(0, 2) }, c = cleanLook(l, g);
    all++; if (JSON.stringify(c) !== JSON.stringify(l) || JSON.stringify(cleanLook(c, g)) !== JSON.stringify(c)) idem = false;
  }
  chk(`${g}: all ${all} combinations of hair, outfit and skin are saved exactly as chosen, and cleaning twice gives the same thing`, idem);
}
chk("a hairstyle of the other gender is replaced by that gender's default", cleanLook({ hair: "gele" }, "M").hair === defaultLook("M").hair && cleanLook({ hair: "braids" }, "F").hair === "braids");
chk("the two hairstyles that have models but used to be unreachable can now be chosen (long for women, braids for men)", HAIR.F.includes("long") && HAIR.M.includes("braids") && cleanLook({ hair: "long" }, "F").hair === "long" && cleanLook({ hair: "braids" }, "M").hair === "braids");
chk("unknown colours, skin tones and accessories are dropped", (() => { const c = cleanLook({ skin: "purple", top: "nope", bottom: 3, acc: ["backpack", "jetpack", "backpack"] }, "M"); return c.skin === defaultLook("M").skin && c.top === defaultLook("M").top && c.bottom === defaultLook("M").bottom && c.acc.join() === "backpack"; })());
chk("lookKey: equal looks give one key, whatever the object or key order", lookKey({ hair: "afro", skin: "ebony" }, "F") === lookKey({ skin: "ebony", hair: "afro", junk: 1 }, "F"));
chk("lookKey: any visible change gives a different key", new Set([lookKey(null, "F"), lookKey({ skin: "ebony" }, "F"), lookKey({ hair: "afro" }, "F"), lookKey({ outfit: "office" }, "F"), lookKey({ top: "red" }, "F"), lookKey({ bottom: "red" }, "F"), lookKey(null, "M")]).size === 7);

// ---------- 2. the crowd keeps its people ----------
{
  let ok = true; for (let s = 0; s < 400; s++) { const f = npcSpec(s, { gender: "F" }), m = npcSpec(s, { gender: "M" }); if (f.look.hair === "long" || m.look.hair === "braids") ok = false; }
  chk("the crowd never uses the player-only additions, so a seed keeps giving the same person", ok);
  chk("an NPC spec is reproducible from its seed", JSON.stringify(npcSpec("abc")) === JSON.stringify(npcSpec("abc")));
}

// ---------- 3. the installed models ----------
const glbJson = (file) => { const b = fs.readFileSync(file), len = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + len).toString("utf8")); };
const fileOf = (url) => path.join(ROOT, "public", url);
const jointNames = (j) => new Set((j.skins ?? []).flatMap((s) => s.joints.map((i) => boneKey(j.nodes[i].name))));
{
  const missing = [], misfit = [], baseJoints = {};
  for (const g of ["M", "F"]) {
    if (!fs.existsSync(fileOf(BASES[g]))) { missing.push(BASES[g]); continue; }
    baseJoints[g] = jointNames(glbJson(fileOf(BASES[g])));
    const lackBones = REQUIRED_BONES.filter((b) => !baseJoints[g].has(b));
    if (lackBones.length) misfit.push(`${BASES[g]} lacks ${lackBones.join(",")}`);
    const needs = [["hair", HAIR[g]], ["outfit", OUTFITS]];
    for (const [slot, ids] of needs) for (const id of ids) {
      const u = partUrl(slot, id, g);
      if (!fs.existsSync(fileOf(u))) { missing.push(u); continue; }
      const stray = [...jointNames(glbJson(fileOf(u)))].filter((b) => !baseJoints[g].has(b));
      if (stray.length) misfit.push(`${u} uses bones the body does not have: ${stray.join(",")}`);
    }
  }
  chk("every hairstyle and outfit a player can choose has a model for that gender" + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""), missing.length === 0);
  chk("every body has the full skeleton and every part fits it" + (misfit.length ? " (" + misfit.join("; ") + ")" : ""), misfit.length === 0);
  chk("hair and outfit are the required slots (nobody is ever shown bald or bare)", REQUIRED_SLOTS.join() === "hair,outfit");
}

// ---------- 4. the real loader, against the real files ----------
// Stand-ins for the few browser features three.js asks for while it reads a model (no drawing happens in this test).
globalThis.self ??= globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
globalThis.ProgressEvent ??= class ProgressEvent extends Event { constructor(t, i = {}) { super(t); Object.assign(this, i); } };
// The built-in character paints a few small textures on a canvas; a context that accepts every drawing call is enough here.
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => (k === "createLinearGradient" || k === "createRadialGradient" ? { addColorStop() {} } : undefined)), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
const Req = globalThis.Request;
globalThis.Request = class extends Req { constructor(u, i) { super(typeof u === "string" && u.startsWith("/") ? "http://localhost" + u : u, i); } };
let net = { online: true, headStatus: null, missing: new Set(), log: [] };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input).replace(/^https?:\/\/[^/]+/, ""), method = init.method ?? input?.method ?? "GET";
  net.log.push(method + " " + url);
  if (!net.online) throw new TypeError("network down");
  if (method === "HEAD" && net.headStatus) return new Response(null, { status: net.headStatus });
  const f = path.join(ROOT, "public", url);
  if (!url.startsWith("/models/") || net.missing.has(url) || !fs.existsSync(f)) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  return new Response(method === "HEAD" ? null : fs.readFileSync(f), { status: 200, headers: { "content-type": "model/gltf-binary" } });
};
const reset = (over = {}) => { net = { online: true, headStatus: null, missing: new Set(), log: [], ...over }; };
// Each scenario gets its own copy of the loader (its own memory of what exists and what was downloaded), as a fresh page load would have.
let copies = 0;
const freshLoader = async () => (await import(`../lib3d/avatar/loadAvatar.js?copy=${++copies}`)).createAvatar;
let createAvatar = await freshLoader();

/** What a character looks like, as plain text: every mesh with its materials and colours, and the body's scale. Equal text = drawn the same. */
const print = (av) => {
  const rows = [];
  av.root.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) rows.push(`${o.name}|${m.name}|${m.color ? m.color.getHexString() : "-"}`); });
  return JSON.stringify({ kind: av.kind, rows: rows.sort(), scale: av.root.scale.toArray().map((x) => +x.toFixed(4)), h: +av.height.toFixed(3) });
};

const saved = { skin: "mahogany", hair: "afro", outfit: "office", top: "teal", bottom: "charcoal", build: "slim", height: "average", acc: [] };
{
  reset();
  const a = await createAvatar(saved, "F"), b = await createAvatar(JSON.parse(JSON.stringify({ ...saved, extra: "ignored" })), "F");
  chk("a saved look builds the authored, rigged human model (not the built-in figure)", a.kind === "glb" && b.kind === "glb");
  chk("the character reports the cleaned look it was built from", JSON.stringify(a.look) === JSON.stringify(cleanLook(saved, "F")) && a.gender === "F");
  chk("the same saved look builds the identical character every time (room, map, buildings, other players)", print(a) === print(b));
  const skin = (av) => { let c = null; av.root.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (/skin/i.test(m.name) && !c) c = m.color.getHexString(); }); return c; };
  chk("the skin is exactly the chosen tone", skin(a) === SKIN_TONES.mahogany.slice(1));
  const c = await createAvatar({ ...saved, top: "red", bottom: "navy" }, "F");
  chk("a different clothing colour really changes the character", print(c) !== print(a));
  const g = await createAvatar(saved, "M");
  chk("the other gender builds its own body", g.kind === "glb" && print(g) !== print(a) && g.gender === "M");
  chk("it has the clips the game plays", ["idle", "walk"].every((n) => a.has(n)));
  // disposing one character must not free what the other copies of the same model share
  let geomFreed = 0, skinFreed = 0; a.root.traverse((o) => { if (o.isMesh) { o.geometry.addEventListener("dispose", () => geomFreed++); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.owned) m.addEventListener("dispose", () => skinFreed++); } });
  a.dispose();
  chk("disposing a character frees its own materials but never the shared geometry", geomFreed === 0 && skinFreed > 0);
  const again = await createAvatar(saved, "F");
  chk("a character built after another was disposed is unchanged", print(again) === print(b));
  b.dispose(); c.dispose(); g.dispose(); again.dispose();
}
{
  // every combination of hair and outfit, both genders: each one is built from real models, never the fallback
  reset(); const fell = [];
  for (const g of ["M", "F"]) for (const hair of HAIR[g]) for (const outfit of OUTFITS) { const av = await createAvatar({ hair, outfit }, g); if (av.kind !== "glb") fell.push(`${g}/${hair}/${outfit}`); av.dispose(); }
  chk("all " + (HAIR.M.length + HAIR.F.length) * OUTFITS.length + " hair x outfit choices load as authored human models" + (fell.length ? " (fell back: " + fell.join(", ") + ")" : ""), fell.length === 0);
}
{
  // a dropped connection must not be remembered as "the model is missing"
  reset({ online: false }); createAvatar = await freshLoader();
  const warn = console.warn; console.warn = () => {}; // the loader reports the failed download; that is expected here
  const off = await createAvatar(saved, "F");
  console.warn = warn;
  chk("offline: the player still gets a character, in the same look", off.kind === "procedural" && JSON.stringify(off.look) === JSON.stringify(cleanLook(saved, "F")));
  off.dispose();
  reset({ online: true });
  const on = await createAvatar(saved, "F");
  chk("back online: the very next character is the real model again (nothing was remembered as missing)", on.kind === "glb");
  on.dispose();
}
{
  // the connection drops for the first load only: the retry gets it right and the player never sees another body
  reset(); createAvatar = await freshLoader(); let first = true; const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => { const u = String(input?.url ?? input); if (first && /base_female/.test(u) && (init?.method ?? input?.method ?? "GET") === "GET") { first = false; throw new TypeError("dropped"); } return real(input, init); };
  const av = await createAvatar({ ...saved, hair: "bun" }, "F");
  globalThis.fetch = real;
  chk("a download that fails once is retried, and the real model is used", av.kind === "glb" && !first);
  av.dispose();
}
{
  // a file that is really missing: the built-in character is drawn in the same look, and only that one look is affected
  reset({ missing: new Set([partUrl("hair", "gele", "F")]) }); createAvatar = await freshLoader();
  const lost = await createAvatar({ hair: "gele", outfit: "owambe", skin: "ebony", top: "purple" }, "F"), t0 = net.log.length;
  chk("a hairstyle file that is not installed gives the built-in character in the same look", lost.kind === "procedural" && lost.look.hair === "gele" && lost.look.skin === "ebony" && lost.look.top === "purple");
  const other = await createAvatar({ hair: "bun", outfit: "owambe" }, "F");
  chk("other looks are unaffected", other.kind === "glb");
  await createAvatar({ hair: "gele", outfit: "owambe" }, "F").then((x) => x.dispose());
  chk("a missing file is asked for once, not on every character", net.log.slice(t0).filter((l) => l.includes("gele_f")).length === 0);
  lost.dispose(); other.dispose();
}
{
  // a host that refuses HEAD (405) is not the same as a missing model
  reset({ headStatus: 405 }); createAvatar = await freshLoader();
  const av = await createAvatar({ hair: "locs", outfit: "casual" }, "M");
  chk("a server that answers HEAD with 405 still serves the real model", av.kind === "glb");
  av.dispose();
}

// ---------- 5. every screen builds players from their saved look, nothing else ----------
{
  const traffic = fs.readFileSync(path.join(ROOT, "lib3d/traffic.js"), "utf8");
  chk("players on the road are built from their own look (createAvatar), not as randomised NPCs", /createAvatar\(t\.look/.test(traffic) && !/npcSpec\(t\.id/.test(traffic));
  const dups = ["lib3d", "lib", "components"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /^look\.js$/.test(f)).map((f) => d + "/" + f));
  chk("the look rules are defined in exactly one place", fs.readFileSync(path.join(ROOT, "lib3d/look.js"), "utf8").includes('export * from "../lib/look.js"') && dups.length === 2);
}

console.log(bad ? `\n${bad} check(s) failed` : "\nAll avatar pipeline checks passed");
process.exit(bad ? 1 : 0);
