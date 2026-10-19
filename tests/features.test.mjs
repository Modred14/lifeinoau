// tests/features.test.mjs
// The feature registry (lib/features.js) feeds the OAU Map panel and the OAU Guide. This test is the safety net that makes it hard to forget
// to register something: it fails when an app, an API route or a building activity exists that the guide does not know about, when a registered
// feature points at a place or app that does not exist, and when the panels would show something false or empty. Pure Node, no database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withExtras } from "../lib3d/mapExtras.js";
import { classify, INTERIOR } from "../lib3d/interiors/registry.js";
import { ACTIVITIES, MAP, activitiesFor } from "../lib/activities.js";
import { allFeatures, featuresAt, activitiesAt, validateRegistry, FEATURES, APP_FEATURES, CATEGORIES, blockedFor, isOffered, DISABLED_ACTIVITIES } from "../lib/features.js";
import { HUSTLE } from "../lib/engine.js";
import { MAP_GROUPS } from "../lib3d/landmarks.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

const data = withExtras(JSON.parse(fs.readFileSync(path.join(root, "public/data/oau-campus.json"), "utf8")));
const placeIds = new Set(data.places.map((p) => p.id)); for (const g of data.gameOnly) placeIds.add(g.id);
// phone apps: the keys of APPS in components/Phone.js
const phone = fs.readFileSync(path.join(root, "components/Phone.js"), "utf8"), block = phone.slice(phone.indexOf("const APPS = {"), phone.indexOf("export const PHONE_APPS"));
const appIds = new Set([...block.matchAll(/^  (\w+): \{ name:/gm)].map((m) => m[1]));
// API routes: every src/app/api/**/route.js
const routes = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name === "route.js") routes.push("/" + path.relative(path.join(root, "src/app"), path.dirname(f)).split(path.sep).join("/")); } })(path.join(root, "src/app/api"));

chk(`found the phone's apps (${appIds.size}) and the API routes (${routes.length})`, appIds.size >= 13 && routes.length >= 40 && appIds.has("guide"));
const problems = validateRegistry({ placeIds, appIds, apiRoutes: routes });
problems.forEach((p) => console.log("      - " + p));
chk("the registry is sound: every app, route and activity is registered, every target exists", problems.length === 0);

// ---- the building panel: every place that has an inside shows its real activities ----
let places = 0, empty = [];
for (const p of data.places) { const cl = classify(p.id, p.kind); if (cl.mode !== "interior") continue; places++; const f = featuresAt(p.id, p.kind); if (!f.activities.length) empty.push(p.id); }
chk(`every enclosed building (${places}) lists at least one activity in its panel`, empty.length === 0 && places > 80);
chk("outdoor places (billboard, gate, statue) list no invented activities", ["bb_1", "gate", "moremi_statue", "main_bowl"].every((id) => featuresAt(id, "").activities.length === 0));
chk("an unnamed campus building (bld_) gets the plain generic activities", activitiesAt("bld_12", "building").length === activitiesFor({ t: "generic" }).length && activitiesAt("bld_12", "building").length > 0);
const sub = activitiesAt("sub", "social"), odu = activitiesAt("oduduwa", "hall");
chk("SUB offers the risky Back-Room Deal, marked risky, with the real pay and the jail risk", sub.some((a) => a.act === "back_room_deal" && a.risk === "risky" && a.gives[0].includes(HUSTLE.risky.max.toLocaleString("en-NG")) && a.costs.join(" ").includes("Floor O")));
chk("Oduduwa Hall offers the safe Event Gig, marked safe and not guaranteed in amount", odu.some((a) => a.act === "event_gig" && a.risk === "safe" && a.certainty === "variable"));
chk("every activity shows a name, an explanation and a button's worth of info", [...placeIds].every((id) => activitiesAt(id, "").every((a) => a.label && a.explain.length > 10 && a.summary)));
chk("no building lists the same activity under the same name twice", [...placeIds].every((id) => { const l = activitiesAt(id, "").map((a) => a.act + a.label); return new Set(l).size === l.length; }));
chk("hostel beds say they are only for your own hall", activitiesAt("h_awo", "hostel").some((a) => a.act === "sleep_bed" && a.requires.some((r) => /own hall/.test(r))));
chk("club activities say they need this week's ticket", activitiesAt("club_quantum", "club").filter((a) => a.act === "dance").every((a) => a.requires.some((r) => /ticket/.test(r))));

// ---- requirements are shown honestly for the player's state ----
const act = (id, label) => activitiesAt(id, "").find((a) => a.act === label);
const tired = { energy: 10, health: 100, personalities: [] }, rested = { energy: 100, health: 100, personalities: [] };
chk("a tired player is told they lack energy for a hustle", /tired/i.test(blockedFor(act("sub", "back_room_deal"), tired, {}) ?? ""));
chk("a rested player is not blocked on stats", blockedFor(act("sub", "back_room_deal"), rested, {}) === null);
chk("a player in custody cannot be offered ordinary activities, but may use the cells", /custody/.test(blockedFor(act("sub", "back_room_deal"), rested, { jailed: true }) ?? "") && blockedFor(act("floor0", "cell_bunk"), { ...rested, energy: 50 }, { jailed: true }) === null);
chk("someone who is not jailed is told the cells are not for them", /serving a sentence/.test(blockedFor(act("floor0", "cell_bunk"), { ...rested, energy: 50 }, {}) ?? ""));
chk("a player who cannot afford the fee is told so", /₦1,500/.test(blockedFor(act("new_bukateria", "eat_meal"), rested, { balanceKobo: "100" }) ?? ""));
chk("a well player is not offered the doctor", /good health/.test(blockedFor(act("health_centre", "health_checkup"), rested, {}) ?? ""));

// ---- disabled, deprecated and partial features are handled ----
chk("a disabled activity would be hidden everywhere", (() => { DISABLED_ACTIVITIES.add("play_games"); const hidden = !activitiesAt("sub", "social").some((a) => a.act === "play_games"); DISABLED_ACTIVITIES.delete("play_games"); return hidden && activitiesAt("sub", "social").some((a) => a.act === "play_games"); })());
chk("partial features say what is missing, and deprecated or disabled ones are not offered", FEATURES.filter((f) => f.status === "partial").every((f) => f.note) && !isOffered({ status: "disabled" }) && !isOffered({ status: "deprecated" }) && isOffered({ status: "partial" }));
chk("the unfinished features (test-only billboard payment, cars without a price, the missing lecture route) are labelled partial", ["social.billboards", "app.ride", "risky.lecturer-fight"].every((id) => FEATURES.find((f) => f.id === id)?.status === "partial"));

// ---- the guide's sections ----
const all = allFeatures();
chk("every guide section has content", CATEGORIES.every((c) => all.some((f) => f.category === c.id)));
chk("legitimate and risky money are separate, with the hustles in the right one", all.find((f) => f.id === "activity.event_gig")?.category === "legit" && all.find((f) => f.id === "activity.back_room_deal")?.category === "risky" && all.find((f) => f.id === "money.jobs").category === "legit" && all.find((f) => f.id === "risky.bet").category === "risky");
chk("the map's own place groups cover every kind of place, so the guide's directory loses none", data.places.every((p) => MAP_GROUPS.some(([, kinds]) => kinds.includes(p.kind))));
chk("the guide is a phone app and appears in the registry as an app", APP_FEATURES.some((f) => f.app === "guide"));

// ---- convention checks: things a new contributor could forget ----
chk("every activity in the catalogue is placed in a building (or switched off)", Object.keys(ACTIVITIES).every((a) => DISABLED_ACTIVITIES.has(a) || Object.values(MAP).some((m) => (Array.isArray(m) ? m : Object.values(m).flat()).some((e) => e.act === a))));
chk("every interior in the interior registry has activities", Object.keys(INTERIOR).every((id) => activitiesAt(id, "").length > 0));
console.log(bad ? `\n${bad} check(s) failed` : "\nAll feature-registry checks passed"); process.exit(bad ? 1 : 0);
