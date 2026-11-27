// tools/oau/bake-campuslife.mjs: writes public/data/oau-campuslife.json, the "look" of the main map taken from the Campuslife campus of commit c2b9477:
// what each building is (kind, name, facade preset, the separate blocks of a hostel compound), the footpaths, where the real trees and shrubs stand, and where the food stalls, hawkers' trays and banners
// are. Run from the repo root (needs the commit in git history, and npx fetches esbuild the first time):
//     node tools/oau/bake-campuslife.mjs && node scripts/assets-manifest.mjs
// Footprints, roads and places stay those of public/data/oau-campus.json; which of the decoration fits on that map, and so stands (solid), is decided by lib3d/campuslife/decor.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const REF = "c2b9477911c431b47e42e5e62f85927c33bf96ba";
const read = (f) => JSON.parse(execFileSync("git", ["show", `${REF}:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 }));
const data = "campus/shared/src/data/";
const campus = read(data + "campus.json"), sites = read(data + "campus-sites.json").sites, styles = read(data + "building-styles.json"), heights = read(data + "building-heights.json").heights, veg = read("campus/client/game/scenery/vegetation.json");
const M = campus.pxPerMeter, r1 = (v) => Math.round(v * 10) / 10;
const ring = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([r1(flat[i] / M), r1(flat[i + 1] / M)]); return out; };
const inRing = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
/**
 * The stalls, hawkers' trays and banners are placed by the old campus's own code, so that code is run: it is taken out of the commit into a temporary folder and bundled with esbuild.
 * The banners' artwork is what that code would hang on one fixed day, from the standing sources only (nothing about elections, fixtures, shows, rented space or birthdays).
 */
async function oldCampus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campuslife-"));
  try {
    execFileSync("tar", ["-x", "-C", dir], { input: execFileSync("git", ["archive", REF, "campus/shared", "lib"], { maxBuffer: 1 << 28 }) });
    const src = "./campus/shared/src/";
    fs.writeFileSync(path.join(dir, "entry.ts"), [`export { STALLS } from "${src}interiors";`, `export { BANNER_SPOTS, BANNER_SOURCES, assignBanners } from "${src}banners";`, `export { HOSTEL_PITCHES, BUSINESS_CENTRES } from "${src}index";`, `export { PLACES } from "${src}map";`, `export { gameTime, gameMinutesAt } from "${src}clock";`].join("\n"));
    // the multiplayer state classes are never used here, so their library is replaced by a stand-in that accepts anything
    fs.writeFileSync(path.join(dir, "schema-stub.js"), `const chain = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => "" : chain()), apply: () => chain(), construct: () => chain() });\nexport const schema = chain(), t = chain(), ArraySchema = chain(), MapSchema = chain();\n`);
    execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "esbuild@0.25.12", "entry.ts", "--bundle", "--format=esm", "--platform=node", "--alias:@colyseus/schema=./schema-stub.js", "--outfile=old.mjs", "--log-level=error"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
    return await import(pathToFileURL(path.join(dir, "old.mjs")).href);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const old = await oldCampus(), r2 = (v) => Math.round(v * 100) / 100, at = (p) => [r2(p.x / M), r2(p.y / M)];
const stalls = old.STALLS.map((s) => [...at(s), r2(s.face), s.style, s.goods, [r2(s.col.x / M), r2(s.col.y / M), r2((s.col.x + s.col.w) / M), r2((s.col.y + s.col.h) / M)]]);
const signs = old.BUSINESS_CENTRES.map((s) => [...at(s), r2(s.face)]);
const pitches = old.HOSTEL_PITCHES.map((p) => { const door = old.PLACES[p.place].door; return [...at(p.at), r2(Math.atan2(door.x - p.at.x, door.y - p.at.y))]; });
const day = old.gameTime(old.gameMinutesAt(Date.UTC(2026, 10, 26, 12))), SOURCES = ["notices", "faculty-week", "adverts", "faith", "sport"];
const feed = [...new Map(old.BANNER_SOURCES.filter((s) => SOURCES.includes(s.name)).flatMap((s) => s.feed(day)).map((a) => [a.id, a])).values()];
const art = [], artAt = new Map(), artIndex = (a) => { let i = artAt.get(a.id); if (i === undefined) { artAt.set(a.id, (i = art.length)); art.push({ title: a.title, lines: a.lines, footer: a.footer, color: a.color, accent: a.accent, ink: a.ink }); } return i; };
const hung = old.assignBanners(old.BANNER_SPOTS, feed, day);
const banners = old.BANNER_SPOTS.map((s, i) => ({ k: s.kind, x: at(s)[0], z: at(s)[1], f: Math.round(s.face * 1000) / 1000, s: r2(s.span / M), a: hung[i].map(artIndex) }));
/** A point that is really inside the outline (the mean of the corners, or else a point of a grid over it). */
const inner = (p) => { const c = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; if (inRing(c[0], c[1], p)) return c;
  const xs = p.map((q) => q[0]), zs = p.map((q) => q[1]); let best = c, bd = Infinity; for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { const x = Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 12, z = Math.min(...zs) + ((Math.max(...zs) - Math.min(...zs)) * j) / 12, d = Math.hypot(x - c[0], z - c[1]); if (d < bd && inRing(x, z, p)) { best = [x, z]; bd = d; } } return best; };
const blocks = sites.flatMap((site) => site.blocks.map((block) => ({ site, block })));
const halls = campus.places.filter((p) => p.building === undefined && styles.halls[p.name]);
const presets = { ...styles.landmarks };
const buildings = campus.buildings.map((b, i) => {
  const pts = ring(b.pts), [x, z] = inner(pts), a = blocks.find(({ block }) => inRing(block.anchor[0] / M, block.anchor[1] / M, pts));
  const kind = a?.site.kind ?? b.kind, name = b.name ?? null;
  let preset = a ? a.block.parts?.[0]?.preset ?? a.block.preset ?? a.site.name : null;
  if (preset && !presets[preset]) preset = null;
  if (!preset && name && presets[name]) preset = name;
  if (!preset && kind === "hostel" && halls.length) {   // every block of a hall takes the nearest hall's look
    const d = (h) => Math.hypot(h.label[0] / M - x, h.label[1] / M - z), hall = halls.reduce((m, h) => (d(h) < d(m) ? h : m));
    preset = "hall:" + hall.name; presets[preset] = styles.halls[hall.name];
  }
  const rec = { x: r1(x), z: r1(z), k: kind, h: a?.site.height ?? heights[i] ?? b.h };
  if (a?.block.parts) rec.parts = a.block.parts.map((q) => (presets[q.preset] ? { o: ring(q.poly), p: q.preset } : { o: ring(q.poly) }));   // the separate blocks of a hostel compound
  if (name) rec.n = name; if (preset) rec.p = preset; if (name || (preset && !preset.startsWith("hall:"))) rec.o = pts;   // the exact outline: named landmarks are modelled on it
  return rec;
});
const paths = [...campus.roads.filter((r) => r.kind === "path").map((r) => ({ w: r.w, pts: ring(r.pts) })), ...sites.flatMap((s) => (s.paths ?? []).map((p) => ({ w: 2.2, pts: ring(p) })))];
const out = { _file: "public/data/oau-campuslife.json (generated by tools/oau/bake-campuslife.mjs from commit c2b9477; do not edit by hand)",
  attribution: "Map data (c) OpenStreetMap contributors (ODbL). " + veg.attribution, width: campus.width / M, height: campus.height / M, presets, buildings, paths, trees: veg.trees, shrubs: veg.shrubs, stalls, signs, pitches, banners, art };
fs.writeFileSync("public/data/oau-campuslife.json", JSON.stringify(out));
console.log(`buildings ${buildings.length}, paths ${paths.length}, trees ${veg.trees.length / 3}, shrubs ${veg.shrubs.length / 3}, stalls ${stalls.length}, trays ${pitches.length}, banners ${banners.length} (${art.length} artworks), ${(fs.statSync("public/data/oau-campuslife.json").size / 1024) | 0} KB`);
