// tests/busy-places.test.mjs
// Busy places: which named places have a real crowd right now, answered without a head count, a player or a position; and the notice that mentions one.
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
import { busyIds, busyThreshold, busyConfig, BUSY_DEFAULTS } from "../lib/busyPlaces.js";
import { busyPlaces } from "../lib/travelService.js";
import { BUSY_ALERT, busyMessage, chooseAlert, emptyHistory, readHistory, recordAlert, writeHistory } from "../lib/busyAlert.js";
import fs from "node:fs";

const ok = (l) => console.log("OK  " + l);

// ---- the rules ----
const cfg = busyConfig({});
assert.deepEqual({ ...cfg }, { ...BUSY_DEFAULTS });
assert.equal(busyThreshold(0, cfg), 3); assert.equal(busyThreshold(10, cfg), 3); assert.equal(busyThreshold(40, cfg), 8, "the bar rises with the crowd in the world: adaptive");
assert.deepEqual(busyIds({ sub: 6, main_bowl: 4, library: 1 }, { cfg }), ["sub", "main_bowl"], "busiest first");
assert.deepEqual(busyIds({ sub: 2, library: 1 }, { cfg }), [], "two friends meeting is not a crowd");
assert.deepEqual(busyIds({ sub: 3, a: 1, b: 1, c: 1 }, { cfg }), ["sub"], "everyone in the world is at SUB but one place: busy");
assert.deepEqual(busyIds({ sub: 4, a: 4, b: 4, c: 4, d: 4, e: 4, f: 4, g: 4 }, { cfg }), [], "no single place stands out when the crowd is spread thin (4 of 32 is not a fifth)");
assert.deepEqual(busyIds({ sub: 6, main_bowl: 5 }, { cfg, exclude: ["sub"] }), ["main_bowl"], "the caller's own place is left out");
assert.deepEqual(busyIds({ sub: 6, floor0: 9 }, { cfg, eligible: (id) => id !== "floor0" }), ["sub"], "an ineligible place is never named, yet still counts toward the world's total");
assert.equal(busyIds({ a: 9, b: 9, c: 9, d: 9, e: 9 }, { cfg: { ...cfg, minShare: 0 } }).length, 3, "at most three places");
assert.deepEqual(busyIds({}, { cfg }), []); assert.deepEqual(busyIds(null, { cfg }), []); assert.deepEqual(busyIds({ x: NaN, y: -2 }, { cfg }), []);
assert.equal(busyConfig({ BUSY_MIN_PLAYERS: "5" }).minPlayers, 5); assert.equal(busyConfig({ BUSY_MIN_PLAYERS: "nonsense" }).minPlayers, 3); assert.equal(busyConfig({ BUSY_MIN_SHARE: "0.5" }).minShare, 0.5); assert.equal(busyConfig({ BUSY_MIN_SHARE: "9" }).minShare, 0.2);
ok("busy rules: floor, adaptive share, order, exclusions, configuration");

// ---- the server answer, against the in-memory database ----
const mk = () => makeDb(["character"]);
const now = Date.now(), ago = (s) => new Date(now - s * 1000);
let n = 0;
const player = (db, over = {}) => { const id = "c" + ++n; db.T().character.push({ id, userId: "u" + n, name: "P" + n, hostel: "Awo", placeId: "", placeAt: null, tripAt: null, jailedUntil: null, ...over }); return "u" + n; };
const crowd = (db, placeId, k, over = {}) => { for (let i = 0; i < k; i++) player(db, { placeId, placeAt: ago(20), ...over }); };

{ // a lively evening
  const db = mk();
  crowd(db, "sub", 6);                                         // gathered at SUB
  crowd(db, "sub", 2, { placeAt: ago(600) });                  // stale: their last report is ten minutes old
  crowd(db, "oduduwa", 4, { tripAt: ago(5) });                 // on the road, passing by
  crowd(db, "main_bowl", 4, { tripAt: ago(120) });             // finished their trip two minutes ago: gathered now
  crowd(db, "floor0", 5, { jailedUntil: new Date(now + 3_600_000) }); // serving a sentence: held, not gathered
  crowd(db, "bld_5", 5);                                       // a crowd in a building the map has no name for
  crowd(db, "library", 1);
  const me = player(db, { placeId: "h_awo", placeAt: ago(10) });
  const r = await busyPlaces(db, me);
  assert.deepEqual(r.places.map((p) => p.id), ["sub", "main_bowl"], "busiest first; passing, stale, held and unnamed players make nothing busy");
  assert.deepEqual(r.places.map((p) => p.name), ["Student Union Building", "Main Bowl"], "named from the campus registry");
  for (const p of r.places) assert.deepEqual(Object.keys(p).sort(), ["id", "name"], "a place is its id and its name, nothing else");
  assert.ok(!/count|total|players|people|\d/.test(JSON.stringify(Object.keys(r))) && !("counts" in r), "no head counts in the answer");
  ok("busy places: only gathered, named places; passing, stale, held and unnamed crowds ignored; no counts");
}
{ // the caller is at the busy place: it is not announced to them; a stranger is told
  const db = mk(); crowd(db, "sub", 5); const inside = player(db, { placeId: "sub", placeAt: ago(5) }), elsewhere = player(db, { placeId: "library", placeAt: ago(5) });
  assert.deepEqual((await busyPlaces(db, inside)).places, [], "never told about the place you are standing in");
  assert.deepEqual((await busyPlaces(db, elsewhere)).places.map((p) => p.id), ["sub"]);
  ok("busy places: your own place is not named to you");
}
{ // quiet world: nothing to say
  const db = mk(); crowd(db, "sub", 2); crowd(db, "library", 1); const me = player(db, { placeId: "h_awo", placeAt: ago(5) });
  assert.deepEqual((await busyPlaces(db, me)).places, []); ok("busy places: a quiet world gives an empty answer");
  const empty = mk(); const solo = player(empty); assert.deepEqual((await busyPlaces(empty, solo)).places, []); ok("busy places: nobody anywhere gives an empty answer");
}
{ // a prisoner is told nothing
  const db = mk(); crowd(db, "sub", 6); const held = player(db, { placeId: "floor0", placeAt: ago(5), jailedUntil: new Date(now + 3_600_000) });
  assert.deepEqual((await busyPlaces(db, held)).places, []); ok("busy places: a player in custody is told nothing");
}

// ---- the notice ----
const sub = { id: "sub", name: "Student Union Building" }, bowl = { id: "main_bowl", name: "Main Bowl" }, odu = { id: "oduduwa", name: "Oduduwa Hall" }, room = { id: "h_ojaja", name: "0203" };
for (const p of [sub, bowl, odu, room]) { const m = busyMessage(p); assert.ok(m.includes(p.name) && /lot of/.test(m), m); assert.ok(!/\b(\d+)\s+(people|players|students)\b/i.test(m), "never a number of people: " + m); assert.equal(m, busyMessage(p), "stable wording"); }
assert.equal(busyMessage({ id: "x", name: "  " }), "");
const msgs = new Set([sub, bowl, odu, room, { id: "a", name: "A" }, { id: "b", name: "B" }].map(busyMessage).map((m) => m.replace(/(at|of|hanging out at) .*/, "")));
assert.ok(msgs.size >= 2, "the wording varies between places");
ok("the notice: names the place, never a number, stable wording");

let h = emptyHistory("c1"), t = 1_000_000;
assert.equal(chooseAlert([], h, t), null); assert.equal(chooseAlert(undefined, h, t), null); assert.equal(chooseAlert([{ id: "x" }], h, t), null, "a place with no name is never mentioned");
let p1 = chooseAlert([sub, bowl], h, t); assert.equal(p1.id, "sub", "the busiest first");
h = recordAlert(h, p1.id, t);
assert.equal(chooseAlert([sub, bowl], h, t + 60_000), null, "the cooldown holds: no second notice a minute later");
assert.equal(chooseAlert([sub], h, t + BUSY_ALERT.cooldownMs + 1), null, "the same place is not news again within the repeat window");
assert.equal(chooseAlert([sub, bowl], h, t + BUSY_ALERT.cooldownMs + 1).id, "main_bowl", "a different busy place rotates in once the cooldown passes");
assert.equal(chooseAlert([sub], h, t + BUSY_ALERT.repeatMs + 1).id, "sub", "and the first place can come back after a long while");
h = { ...h, count: BUSY_ALERT.maxPerSession }; assert.equal(chooseAlert([bowl], h, t + 10 * BUSY_ALERT.repeatMs), null, "a visit never gets more than the maximum");
const mem = new Map(), store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
writeHistory(store, recordAlert(emptyHistory("c1"), "sub", t)); assert.equal(readHistory(store, "c1").count, 1); assert.equal(readHistory(store, "c2").count, 0, "another player on the same device starts clean");
mem.set("oau:busy-alerts", "{broken"); assert.equal(readHistory(store, "c1").count, 0, "damaged storage starts clean"); assert.equal(readHistory(null, "c1").count, 0);
assert.equal(BUSY_ALERT.delayMs, 2000, "the first look is about two seconds after the game opens");
ok("the notice: cooldown, rotation, repeat window, session cap, storage");

// ---- wiring: one mount for the whole session, the existing notification system, the existing navigation ----
const src = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const shell = src("components/Shell.js"), comp = src("components/BusyAlerts.js");
assert.equal((shell.match(/<BusyAlerts/g) ?? []).length, 1, "mounted once, by the Shell that lives across every screen");
assert.ok(/clearTimeout\(timer\)/.test(comp) && /clearInterval\(again\)/.test(comp) && /alive = false/.test(comp), "the timers are cleaned up");
assert.ok(/toast\.info\(/.test(comp) && /oau:goto/.test(comp) && /\/map\?to=/.test(comp), "uses the game's toast and the map's own goto");
assert.ok(!/\br\.counts\b|\.total\b/.test(comp), "the component reads no head count (the answer has none)");
console.log("Busy places: real gatherings only, said without numbers, once, and never spammed.");
