// tests/building-panel.test.mjs
// The Building Activities Panel (components/BuildingPanel.js, lib/buildingPanel.js). Pure Node, no database, no browser:
//   - the cards come from the real activity registry and the real rings of real interiors, so a building never lists something it cannot place;
//   - RISKY comes from the game's rules (HUSTLE, def.risky), never from a name;
//   - walking time comes from a real distance at the walker's own speed;
//   - the source keeps the promises that cannot be run here: it walks with the scene's walkTo (never teleport), docks with the bar, sits under the phone.
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildInterior, classify } from "../lib3d/interiors/index.js";
import { activityHubs } from "../lib3d/interiors/activityHubs.js";
import { ACTIVITIES } from "../lib/activities.js";
import { buildCards, chipsFor, nearestRing, riskInfo, walkSeconds, walkLabel, waitLabel, WALK_SPEED, NEAR_METRES } from "../lib/buildingPanel.js";
import { HUSTLE } from "../lib/engine.js";

let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK   " : "FAIL ") + l); };
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

// ---- walking time
chk("walking time: standing at the ring needs no walking", walkSeconds(0) === 0 && walkSeconds(NEAR_METRES) === 0 && walkLabel(0) === "Right here");
chk("walking time uses the walker's real speed (1.9 m/s)", WALK_SPEED === 1.9 && walkSeconds(19) === 10 && walkSeconds(2) === 2);
chk("walking time labels", walkLabel(12) === "12s walk" && walkLabel(65) === "1m 05s walk" && waitLabel(4 * 60_000) === "4m");
chk("the scene's automatic walk really runs at that speed", /step = 1\.9 \* dt/.test(read("lib3d/interiors/scene.js")));

// ---- real interiors: every card has a ring, every ring-bearing activity has a card
const d = withExtras(JSON.parse(read("public/data/oau-campus.json"))), all0 = new Map();
for (const l of LANDMARKS) all0.set(l.id, { id: l.id, name: l.name, kind: l.kind });
for (const p of d.places) all0.set(p.id, { id: p.id, name: p.name, kind: p.kind });
const places = [...all0.values()].filter((p) => classify(p.id, p.kind).mode === "interior");
let withActivities = 0, risky = 0, allCards = 0;
for (const p of places) {
  const c = buildInterior(p); if (!c) continue;
  const rings = activityHubs(c, classify(p.id, p.kind).spec).hubs;
  const hubs = rings.map((r) => ({ id: r.id, blocked: null, until: 0 }));
  const cards = buildCards({ placeId: p.id, kind: p.kind, rings, hubs, character: null });
  if (!cards.length) continue; withActivities++; allCards += cards.length;
  if (!cards.every((k) => k.rings.length > 0 && k.rings.every((r) => Number.isFinite(r.x) && Number.isFinite(r.z)))) chk(p.id + ": every card has a real destination", false);
  if (!cards.every((k) => k.label && k.icon && k.summary && k.seconds > 0)) chk(p.id + ": every card has a name, icon, description and length", false);
  for (const k of cards) {
    const def = ACTIVITIES[k.act];
    if ((k.risk === "risky") !== (def.kind === "hustle_risky" || !!def.risky)) chk(p.id + ": " + k.act + " risk follows the rules", false);
    if (k.risk === "risky") { risky++; if (!k.risky?.lines.length || !k.risky.confirm.title.includes("RISKY")) chk(p.id + ": " + k.act + " explains its risk and confirms with RISKY", false); }
    if (k.risk !== "risky" && k.risky) chk(p.id + ": " + k.act + " is safe and must not be tagged", false);
  }
}
chk(`${places.length} interiors checked; ${withActivities} offer activities (${allCards} cards)`, withActivities > 0 && allCards > 0);
chk("risky activities exist and every one carries the explanation", risky > 0);

// ---- a card is shown only when the room has a ring for it and the server offers it to this player
const sample = places.find((p) => { const c = buildInterior(p); return c && activityHubs(c, classify(p.id, p.kind).spec).hubs.length >= 2; });
const sc = buildInterior(sample), srings = activityHubs(sc, classify(sample.id, sample.kind).spec).hubs;
const all = buildCards({ placeId: sample.id, kind: sample.kind, rings: srings, hubs: srings.map((r) => ({ id: r.id })), character: null });
chk("loading: no cards at all until the server has answered", buildCards({ placeId: sample.id, kind: sample.kind, rings: srings, hubs: null }) === null);
chk("no ring in this room, no card", buildCards({ placeId: sample.id, kind: sample.kind, rings: [], hubs: srings.map((r) => ({ id: r.id })) }).length === 0);
chk("the server hiding a ring hides its card", buildCards({ placeId: sample.id, kind: sample.kind, rings: srings, hubs: [] }).length === 0);
const blockedOne = buildCards({ placeId: sample.id, kind: sample.kind, rings: srings, hubs: srings.map((r, i) => ({ id: r.id, blocked: i === 0 ? "Ready in a while." : null, until: i === 0 ? Date.now() + 60_000 : 0 })), character: null });
chk("unavailable cards are kept (with the reason) but listed after the available ones", blockedOne.some((c) => c.blocked) && blockedOne.findIndex((c) => c.blocked) >= blockedOne.filter((c) => !c.blocked).length);

// ---- risk comes from the rules
const deal = { risk: "risky", kind: "hustle_risky", label: "Back-Room Deal", costs: [] };
const info = riskInfo(deal);
chk("the back-room deal's risk text uses the real HUSTLE numbers", info.lines.join(" ").includes(String(HUSTLE.risky.jailMin)) && info.lines.join(" ").includes(String(HUSTLE.risky.jailMax)) && /Floor O/.test(info.lines.join(" ")));
chk("a safe activity has no risk info", riskInfo({ risk: "safe", costs: [] }) === null);
const exam = all.find((c) => c.kind === "exam");
if (exam) chk("the exam is not tagged RISKY (cheating is a separate choice) but says so", !exam.risky && !!exam.note);

// ---- chips
chk("chips only when they would filter something", chipsFor([{ category: "rest" }, { category: "rest" }]).length === 0 && chipsFor([{ category: "rest" }, { category: "learn" }]).length === 2);

// ---- the nearest ring is chosen by the real route, and "already here" is honoured
const rs = [{ id: "a", x: 0, z: 0, floor: 0 }, { id: "b", x: 10, z: 0, floor: 0 }];
const route = (r) => (r.id === "x" ? null : { length: Math.hypot(r.x - 6, r.z), speed: 1.9 });
chk("nearestRing picks the shorter real route", nearestRing(rs, route, { x: 6, z: 0, floor: 0 }).ring.id === "b");
chk("nearestRing skips rings with no route", nearestRing([{ id: "x", x: 0, z: 0 }, rs[1]], route).ring.id === "b" && nearestRing([{ id: "x", x: 0, z: 0 }], route) === null);
chk("nearestRing reports 0 seconds when already standing at it", nearestRing(rs, route, { x: 10.5, z: 0, floor: 0 }).seconds === 0);

// ---- source promises
const panel = read("components/BuildingPanel.js"), inside = read("components/BuildingInside.js"), scene = read("lib3d/interiors/scene.js"), layer = read("components/ActivityLayer.js");
const css = read("components/building-panel.css"), navCss = read("components/bottom-nav.css"), phoneCss = read("components/phone.css"), travelCss = read("components/travel.css");
chk("choosing an activity walks with the scene's own walkTo", /api\.current\.walkTo\(/.test(panel) && /walkTo\(x, z(, floor)?\)/.test(scene));
chk("the panel never teleports the character", !/teleport\(/.test(panel) && !/setPosition|P\.x\s*=/.test(panel));
chk("the panel starts nothing itself (the server-checked ActivityLayer does, after arrival)", !/op: "start"|\bcall\(/.test(panel) && /onArrive\(ring/.test(panel));
chk("a risky activity is confirmed before the character sets off", /c\.risky && !\(await confirmAction/.test(panel));
chk("the panel can cancel a walk and the scene can stop it", /cancelWalk/.test(panel) && /cancelWalk\(\)/.test(scene));
chk("a blocked walk gives up and says so", /route\.stuck > 1\.6/.test(scene) && /The way was blocked/.test(panel));
chk("BuildingInside mounts the panel and keeps the existing movement system", /<BuildingPanel /.test(inside) && !/new Walker|createNav\(/.test(inside + panel));
chk("ActivityLayer skips the second confirmation and auto-starts only plain activities", /!open\?\.confirmed/.test(layer) && /info\.kind !== "stats" && info\.kind !== "hustle_safe"/.test(layer));
chk("the RISKY badge is also on the in-room activity card", /className="bp-risky">RISKY/.test(layer));
chk("the panel and the bar share one surface (same background token, one top border)", /var\(--bp-bg\)/.test(css) && /var\(--bp-bg\)/.test(navCss) && /border-width: 0 1px/.test(navCss) && /border-bottom: 0/.test(css));
chk("the panel's height follows the measured bar and the viewport", /--bp-nav-h/.test(css) && /100dvh/.test(css) && /getBoundingClientRect/.test(panel) && /ResizeObserver/.test(panel));
chk("the panel scrolls when it has to and can fold", /overflow-y: auto/.test(css) && /aria-expanded/.test(panel));
chk("the movement controls are lifted above the panel", /\.bi3 \.th-stick \{ bottom: calc\(var\(--safe-b\) \+ var\(--bp-h/.test(css));
const z = (c, sel) => +(c.match(new RegExp("^" + sel.replace(/[.]/g, "\\.") + " \\{[^}]*?z-index: *(\\d+)", "m"))?.[1] ?? NaN);
chk("the panel sits inside the room, so the phone (85) is above it", z(travelCss, ".bi3") < +phoneCss.match(/--z-phone: *(\d+)/)[1] && /<BuildingPanel/.test(inside) && inside.indexOf("<BuildingPanel") > inside.indexOf('className="th bi3-hud"'));
chk("the room stays mounted behind the phone (no second phone, no reset)", /oau:phone-state/.test(inside) && !/<Phone\b|oau:phone/.test(panel));
process.exit(bad ? 1 : 0);
