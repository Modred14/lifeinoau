// tests/campus-real.test.mjs
// Checks the real-map data (public/data/oau-campus.json) and its helpers. Pure Node: no 3D library, no network.
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { listPlaces, placeMeta, trustNote } from "../lib3d/campusData.js";
import { withExtras } from "../lib3d/mapExtras.js";
const ok = (l, c) => console.log((c ? "OK  " : "FAIL") + " " + l); let bad = 0; const chk = (l, c) => { if (!c) bad++; ok(l, c); };
const d = JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")), b = d.bounds;
const fin = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const within = (p, pad = 5) => p[0] >= b.x0 - pad && p[0] <= b.x1 + pad && p[1] >= b.z0 - pad && p[1] <= b.z1 + pad;
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; } return Math.abs(a) / 2; };

chk(`attribution is kept: "${d.meta.attribution}"`, /OpenStreetMap/.test(d.meta.attribution));
chk("no absolute latitude/longitude is claimed", /no latitude\/longitude|none/i.test(d.meta.absoluteGeoreference) && !("origin" in d));
chk(`scale is the documented zoom-17 value (${d.meta.mPerPx} m/px)`, Math.abs(d.meta.mPerPx - 1.184) < 0.01);
chk(`mapped extent is ${(b.x1 - b.x0).toFixed(0)} x ${(b.z1 - b.z0).toFixed(0)} m (a screenshot of a few km, not a country)`, b.x1 - b.x0 > 2500 && b.x1 - b.x0 < 4000 && b.z1 - b.z0 > 1200 && b.z1 - b.z0 < 2500);

chk(`building footprints: ${d.buildings.length} (expect 450 to 700 from the supplied render)`, d.buildings.length > 450 && d.buildings.length < 700);
chk("every footprint has 3+ finite points, all inside the mapped extent", d.buildings.every((q) => q.pts.length >= 3 && q.pts.every(fin) && q.pts.every((p) => within(p))));
chk("footprint areas are plausible buildings (3 m2 to 12,000 m2)", d.buildings.every((q) => { const a = area(q.pts); return a > 3 && a < 12000; }));
chk("building ids are unique", new Set(d.buildings.map((q) => q.id)).size === d.buildings.length);
const hs = d.buildings.filter((q) => q.hSrc === "default-5-8m");
chk(`default heights stay inside the published 5 to 8 m range (${hs.length} buildings)`, hs.every((q) => q.h >= 5 && q.h <= 8));
const senate = d.places.find((p) => p.id === "senate"), library = d.places.find((p) => p.id === "library");
chk("Senate Building is 24 m and marked as published (8 floors, MAGG 2025)", d.buildings[senate.bid].h === 24 && d.buildings[senate.bid].hSrc === "published-MAGG-2025");
chk("library height is marked as an estimate, not a fact", d.buildings[library.bid].hSrc === "estimate-multistorey");
chk("the Senate footprint is a real building (over 1,000 m2)", d.buildings[senate.bid].area > 1000);

chk(`road polygons: ${d.roads.length}, all points finite`, d.roads.length > 3 && d.roads.every((r) => r.pts.length >= 3 && r.pts.every(fin)));
chk("landcover present: water, pitches, wooded park, parking", ["water", "pitch", "wood", "parking"].every((k) => d.areas[k].length > 0));

const ids = d.places.map((p) => p.id);
chk(`place ids are unique (${ids.length} placed)`, new Set(ids).size === ids.length);
chk("every placed place has a name, kind, tier 1-3, confidence and source", d.places.every((p) => p.name && p.kind && [1, 2, 3].includes(p.tier) && p.conf && p.src));
chk("every placed place has finite coordinates inside the map (Damico is marked off-map)", d.places.every((p) => fin([p.x, p.z]) && (p.offmap || within([p.x, p.z]))));
chk("a place that points at a footprint points at one that exists", d.places.every((p) => p.bid == null || d.buildings[p.bid]?.id === p.bid));
chk("two places never share one footprint (no label stacked on another building)", (() => { const s = new Map(); for (const p of d.places) if (p.bid != null) { if (s.has(p.bid)) return false; s.set(p.bid, p.id); } return true; })());
const g = d.meta.georef.googleToOsm;
chk(`Google screenshot fit: rotation ${g.rotationDeg} deg, RMS ${g.rmsM} m (approximate, under 60 m)`, Math.abs(g.rotationDeg) < 3 && g.rmsM < 60);
chk("places read from Google are marked approximate", d.places.filter((p) => p.src === "google-screenshot").every((p) => p.conf === "approximate"));
chk("places read from the OSM render are never called verified", d.places.filter((p) => p.src === "osm-screenshot").every((p) => p.conf === "named-in-osm-render"));

// stable ids for gameplay: every id the game already had is either on the map or explicitly listed as having no position
const dx = withExtras(d), known = new Set([...dx.places.map((p) => p.id), ...dx.gameOnly.map((x) => x.id)]), lost = LANDMARKS.filter((l) => !known.has(l.id)).map((l) => l.id);
chk(`every existing game place id is still available (missing: ${lost.join(", ") || "none"})`, lost.length === 0);
chk("game-only places are never given coordinates", d.gameOnly.every((x) => !("x" in x) && !("z" in x) && !ids.includes(x.id)));
const hostels = ["h_moremi", "h_alumni", "h_mozambique", "h_angola", "h_awo", "h_etf", "h_fajuyi"];
chk("the seven hostels found on the map are all placed with tier 1", hostels.every((h) => d.places.find((p) => p.id === h)?.tier === 1));
chk("hostels that appear in no reference (Akintola, Ojaja) are reported, not invented", ["h_akintola", "h_ojaja"].every((h) => d.gameOnly.some((x) => x.id === h)));
const near = (a, c) => Math.hypot(a.x - c.x, a.z - c.z);
const P = (id) => d.places.find((p) => p.id === id);
chk(`Wikipedia: Student Union Building is on the road south of the quadrangle (SUB z ${P("sub").z} > Oduduwa Hall z ${P("oduduwa").z})`, P("sub").z > P("oduduwa").z);
chk(`library is north-east of Oduduwa Hall, as in the OSM render (${near(P("library"), P("oduduwa")).toFixed(0)} m apart)`, P("library").x > P("oduduwa").x && P("library").z < P("oduduwa").z);
chk("the Main Bowl outline is about 157 x 73 m along its own axes (standard 400 m track), within 10%", (() => { const ext = (pts) => { const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, mz = pts.reduce((a, p) => a + p[1], 0) / n; let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of pts) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); } const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), c = Math.cos(th), s = Math.sin(th), u = pts.map(([x, z]) => (x - mx) * c + (z - mz) * s), v = pts.map(([x, z]) => -(x - mx) * s + (z - mz) * c); return [Math.max(...u) - Math.min(...u), Math.max(...v) - Math.min(...v)].sort((a, b) => b - a); }; return d.areas.pitch.some((q) => { const [L, W] = ext(q.pts); return Math.abs(L - 157) < 16 && Math.abs(W - 73) < 8; }); })());

// helpers
const list = listPlaces(d), meta = placeMeta(d);
chk(`listPlaces returns placed and unplaced places (${list.length}: ${list.filter((p) => !p.located).length} without a position)`, list.length === ids.length + d.gameOnly.length && list.filter((p) => !p.located).length === d.gameOnly.length);
chk("game blurbs and actions survive the merge", list.find((p) => p.id === "oduduwa").actions.length > 0 && meta.library.blurb.length > 10);
chk("every place gets a plain blurb", list.every((p) => typeof p.blurb === "string" && p.blurb.length > 5));
chk("trust notes tell the three cases apart", new Set(list.map(trustNote)).size === 3);

console.log(bad ? `\n${bad} check(s) failed` : "\nall real-map data checks passed"); process.exit(bad ? 1 : 0);
