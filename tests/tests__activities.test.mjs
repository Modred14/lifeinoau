// tests/activities.test.mjs
// tests/activities.test.mjs: building activities. Part 1: the building-to-activity map against every real interior (pure, no database).
// Part 2: the rules (costs, budgets, cooldowns, position). Part 3: the server service against the in-memory fake database, with the clock controlled.
import assert from "node:assert/strict";
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { classify, buildInterior } from "../lib3d/interiors/index.js";
import { activityHubs, MIN_GAP } from "../lib3d/interiors/activityHubs.js";
import { ACTIVITIES, MAP, BUDGET, PRESENCE, STAT_KEYS, HUSTLE_NAMES, activitiesFor, effectsOf, budgeted, spentOf, unmet, cooldownEnd, stepAllowed, nearHub, apply, worthless } from "../lib/activities.js";
import { makeDb } from "./fakedb.mjs";
import * as G from "../lib/gameService.js";
import * as S from "../lib/activityService.js";

let bad = 0; const chk = (l, c, more) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && more ? "\n     " + more : "")); };

// ============================================================================================================== 1. the map
const d = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const all = new Map(); for (const l of LANDMARKS) all.set(l.id, { id: l.id, name: l.name, kind: l.kind }); for (const p of d.places) all.set(p.id, { id: p.id, name: p.name, kind: p.kind });
const inter = [...all.values()].map((p) => ({ p, c: classify(p.id, p.kind) }));
const built = new Map();
for (const { p, c } of inter) { if (c.mode !== "interior") continue; const comp = buildInterior(p); built.set(p.id, { p, spec: c.spec, comp, ...activityHubs(comp, c.spec) }); }
chk(`${built.size} interiors have an activity map`, built.size > 60);
for (const [id, b] of built) {
  const probs = [];
  if (!b.hubs.length) probs.push("no activities");
  if (b.missing.length) probs.push("missing " + JSON.stringify(b.missing));
  const nv = (f) => b.comp.navPlayer[f];
  for (const h of b.hubs) { const [i, j] = nv(h.floor).cell(h.x, h.z); if (!nv(h.floor).at(i, j) || !b.comp.reach[h.floor][j * nv(h.floor).nx + i]) probs.push(`${h.id} not on reachable floor`); }
  for (let i = 0; i < b.hubs.length; i++) for (let k = i + 1; k < b.hubs.length; k++) if (b.hubs[i].floor === b.hubs[k].floor && Math.hypot(b.hubs[i].x - b.hubs[k].x, b.hubs[i].z - b.hubs[k].z) < MIN_GAP - 0.01) probs.push(`${b.hubs[i].id} and ${b.hubs[k].id} too close`);
  for (const ph of b.comp.hubs) for (const h of b.hubs) if ((ph.floor ?? 0) === h.floor && Math.hypot(ph.x - h.x, ph.z - h.z) < 1.2) probs.push(`${h.id} on top of the "${ph.label}" ring`);
  const ids = b.hubs.map((h) => h.id); if (new Set(ids).size !== ids.length) probs.push("duplicate ring ids");
  chk(`${id} (${b.spec.t}): ${b.hubs.length} activities`, probs.length === 0, probs.slice(0, 4).join("; "));
}
const has = (id, act) => built.get(id)?.hubs.some((h) => h.act === act);
chk("Oduduwa Hall has the low-risk hustle (Event Gig)", has("oduduwa", "event_gig") && ACTIVITIES.event_gig.label === HUSTLE_NAMES.safe);
chk("the SUB has the high-risk hustle (Back-Room Deal)", has("sub", "back_room_deal") && ACTIVITIES.back_room_deal.label === HUSTLE_NAMES.risky);
chk("the hustles are in exactly those two buildings", [...built.values()].filter((b) => b.hubs.some((h) => h.act === "event_gig" || h.act === "back_room_deal")).map((b) => b.p.id).sort().join() === "oduduwa,sub");
for (const [id, b] of built) if (["faculty", "theatre", "classrooms"].includes(b.spec.t)) chk(`${id}: classes, a test, the exam and study`, ["attend_class", "class_test", "sit_exam", "study_course"].every((a) => has(id, a)));
for (const [id, b] of built) if (b.spec.t === "hostel" || b.spec.t === "block") chk(`${id}: beds for rest`, b.hubs.some((h) => h.act === "sleep_bed" || h.act === "bunk_rest"));
for (const [id, b] of built) if (b.spec.t === "hostel") chk(`${id}: a bed in every bedroom`, b.hubs.filter((h) => h.act === "sleep_bed").length >= 4);
chk("the clinics treat people", ["health_centre", "medical_unnamed"].every((id) => !built.has(id) || (has(id, "health_checkup") && has(id, "buy_medicine") && has(id, "triage_treatment"))));
chk("worship places have worship", [...built.values()].filter((b) => b.spec.t === "church" || b.spec.t === "mosque").every((b) => b.hubs.some((h) => h.act === "worship_service")));
chk("clubs have dancing", [...built.values()].filter((b) => b.spec.t === "club").every((b) => b.hubs.some((h) => h.act === "dance")));
chk("outdoor places have no interior and so no activities", ["amphitheatre", "motion_ground", "main_bowl", "sports_centre", "basketball", "gate", "moremi_statue", "zoo", "bio_gardens", "damico", "ede_road"].every((id) => !all.has(id) || !built.has(id)));
chk("billboards have none", [...all.values()].filter((p) => p.kind === "billboard" || p.id.startsWith("bb_")).every((p) => !built.has(p.id)));
// not one identical list for every building
const sig = new Set([...built.values()].map((b) => b.hubs.map((h) => h.act).sort().join()));
chk(`the activity lists differ between buildings (${sig.size} different lists)`, sig.size >= 20);
// the catalog itself
const used = new Set(); (function walk(m) { for (const v of Object.values(m)) { if (Array.isArray(v)) v.forEach((e) => used.add(e.act)); else walk(v); } })(MAP);
chk("every activity in the map exists in the catalog", [...used].every((a) => Object.hasOwn(ACTIVITIES, a)), [...used].filter((a) => !ACTIVITIES[a]).join());
chk("every activity in the catalog is used by some building (or is the extra computer-lab one)", Object.keys(ACTIVITIES).every((a) => used.has(a) || a === "practical"), Object.keys(ACTIVITIES).filter((a) => !used.has(a)).join());
const reach = new Set(); for (const b of built.values()) for (const h of b.hubs) reach.add(h.act);
chk("every catalog activity appears in at least one real building", Object.keys(ACTIVITIES).every((a) => reach.has(a)), Object.keys(ACTIVITIES).filter((a) => !reach.has(a)).join());
// balance
for (const [id, a] of Object.entries(ACTIVITIES)) {
  const bits = []; if (a.sec < 5 || a.sec > 120) bits.push("duration");
  for (const k of Object.keys(a.d)) if (!STAT_KEYS.includes(k)) bits.push("unknown stat " + k);
  if ((a.d.academics ?? 0) > 1 || (a.d.popularity ?? 0) > 1) bits.push("academics/popularity step above 1");
  if ((a.d.energy ?? 0) > 30) bits.push("energy step above 30");
  if ((a.d.health ?? 0) > 20) bits.push("health step above 20");
  if (a.kind === "stats" && a.d.energy > 0 && !a.cd) bits.push("energy gain without a cooldown");
  if (a.kind === "stats" && !Object.values(a.d).some((v) => v > 0) && !Object.values(a.d).some((v) => v < 0)) bits.push("changes nothing");
  if (!Array.isArray(a.anim) || !a.anim.length) bits.push("no animation");
  chk(`activity ${id} is balanced`, bits.length === 0, bits.join(", "));
}

// ============================================================================================================== 2. the rules
const me = { energy: 50, health: 50, happiness: 50, academics: 50, popularity: 50, personalities: [] };
assert.deepEqual(effectsOf(me, ACTIVITIES.sleep_bed).d, { health: 2, energy: 50 }, "sleep fills the bar to 100"); assert.equal(ACTIVITIES.sleep_bed.sec, 30, "a sleep lasts 30 seconds"); assert.equal(effectsOf({ ...me, energy: 0 }, ACTIVITIES.bunk_rest).d.energy, 100, "0 to 100 percent");
assert.equal(effectsOf({ ...me, personalities: ["Introvert"] }, ACTIVITIES.union_meeting).d.popularity, undefined, "an Introvert gains nothing from a 1-point social gain");
assert.equal(effectsOf({ ...me, personalities: ["Extrovert"] }, ACTIVITIES.union_meeting).d.popularity, 2);
assert.equal(effectsOf({ ...me, personalities: ["Party Animal"] }, ACTIVITIES.dance).d.happiness, 6);
{ const out = budgeted({ health: 2, energy: 100 }, { energy: 60, health: 0 }); assert.deepEqual(out.d, { energy: 10, health: 2 }); assert.deepEqual(out.capped, ["energy"]);
  assert.deepEqual(budgeted({ energy: 30 }, { energy: 70 }).d, {}, "nothing left of the allowance");
  assert.deepEqual(budgeted({ energy: -12 }, { energy: 70 }).d, { energy: -12 }, "costs always apply"); }
{ const dayStart = Date.UTC(2026, 9, 18), week = 5, runs = [{ status: "DONE", delta: { energy: 30, academics: 1 }, startedAt: new Date(dayStart + 1000), gameWeek: week }, { status: "DONE", delta: { energy: 20 }, startedAt: new Date(dayStart - 1000), gameWeek: week }, { status: "CANCELLED", delta: { energy: 99 }, startedAt: new Date(dayStart + 5), gameWeek: week }];
  const sp = spentOf(runs, { week, dayStart }); assert.equal(sp.energy, 30, "energy is counted per day, and only finished runs"); assert.equal(sp.academics, 1, "academics is counted per game week"); }
{ const base = { now: 1000, runs: [], day: 0, week: 0 };
  assert.equal(unmet({ ...me, energy: 95 }, ACTIVITIES.sleep_bed, base), "You are not tired enough for that.");
  assert.equal(unmet({ ...me, energy: 5 }, ACTIVITIES.play_squash, base), "You are too tired for that. Rest first.");
  assert.equal(unmet({ ...me, health: 95 }, ACTIVITIES.health_checkup, base) !== null, true);
  assert.match(unmet(me, ACTIVITIES.sleep_bed, { ...base, cooldownEndsAt: 5000 }), /Again in/);
  assert.match(unmet(me, ACTIVITIES.sleep_bed, { ...base, day: 6 }), /times today/);
  assert.match(unmet(me, ACTIVITIES.class_test, { ...base, week: 1 }), /this week/);
  assert.equal(unmet(me, ACTIVITIES.sleep_bed, base), null);
  assert.equal(cooldownEnd(ACTIVITIES.sleep_bed, [{ status: "DONE", startedAt: new Date(1000), finishedAt: new Date(2000), endsAt: new Date(2000) }]), 2000 + 60 * 1000);
  assert.equal(cooldownEnd(ACTIVITIES.sleep_bed, [{ status: "CANCELLED", startedAt: new Date(1000) }]), 0, "a stopped run does not start a cooldown"); }
assert.equal(worthless(ACTIVITIES.health_checkup, me, { health: 8 }), true); assert.equal(worthless(ACTIVITIES.sleep_bed, me, { energy: 70 }), false, "sleep ignores the energy allowance");
assert.deepEqual(apply({ ...me, energy: 95 }, { energy: 30, health: -60 }).stats.energy, 100);
assert.equal(apply({ ...me, health: 10 }, { health: -60 }).stats.health, 0);
// position rules
assert.equal(stepAllowed({ x: 0, z: 0, at: 0 }, { x: 4, z: 0 }, 1000), true); assert.equal(stepAllowed({ x: 0, z: 0, at: 0 }, { x: 30, z: 0 }, 1000), false, "30 m in a second is not walking");
assert.equal(stepAllowed({ x: 0, z: 0, at: 0 }, { x: 30, z: 0 }, 10_000), true); assert.equal(stepAllowed({ x: 0, z: 0, at: 0 }, { x: NaN, z: 0 }, 99_000), false);
assert.equal(nearHub({ x: 1, z: 1, floor: 0 }, { x: 2, z: 1, floor: 0 }), true); assert.equal(nearHub({ x: 1, z: 1, floor: 1 }, { x: 2, z: 1, floor: 0 }), false, "another floor is not near");
assert.equal(nearHub({ x: 0, z: 0, floor: 0 }, { x: PRESENCE.hubRadius + 0.1, z: 0, floor: 0 }), false);
assert.ok(Object.keys(BUDGET).every((k) => STAT_KEYS.includes(k)));
// activities per building differ in purpose: spot checks on the catalog's meaning
assert.ok(ACTIVITIES.sleep_bed.full && !ACTIVITIES.nap_common.full, "a bed fills the bar, a sofa only tops it up");
assert.ok(ACTIVITIES.triage_treatment.d.health > ACTIVITIES.buy_medicine.d.health, "treatment heals more than medicine");
assert.ok(ACTIVITIES.play_squash.d.energy < 0 && ACTIVITIES.play_squash.d.health > 0, "sport costs energy and builds health");
assert.deepEqual(activitiesFor({ t: "mosque" }).map((e) => e.act), ["worship_service", "fellowship", "quran_study"]);
assert.deepEqual(activitiesFor({ t: "nowhere" }), []);
chk("the pure rules hold", true);

// ============================================================================================================== 3. the service
const H = 3_600_000, MIN = 60_000, DAY = 24 * H, N = (n) => BigInt(n) * 100n;
const START = Date.UTC(2026, 9, 1, 15, 30);
const realNow = Date.now; let clock = START + 5 * DAY + H; Date.now = () => clock;
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "achievementAward", "business", "holding", "partyTicket", "bond", "activityRun", "courseProgress"];
const FACULTY = { name: "Science", difficulty: 1.1 };
function world(over = {}) {
  const db = makeDb(models, { unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"], activityRun: ["characterId", "requestId"], examResult: ["characterId", "gameWeek"] }, join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: FACULTY }) } });
  const T = db.T();
  T.account.push({ id: "acc1", kind: "PLAYER", systemName: null, characterId: "c1", balance: N(1_000_000) }, { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "v", kind: "SYSTEM", systemName: "VENUES", balance: 0n }, { id: "d", kind: "SYSTEM", systemName: "DSA", balance: 0n });
  T.gameClock.push({ id: 1, startedAt: new Date(START) });
  T.character.push({ id: "c1", userId: "u1", name: "Tester", hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 100, health: 80, happiness: 60, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 9999, joinedWeek: 1, sessionStartWeek: 1, level: 100, class: "LAPO", placeId: "oduduwa", energyRefilledAt: new Date(clock), inPlace: "", inX: null, inZ: null, inFloor: 0, inAt: null, ...over });
  return { db, T, get c() { return T.character[0]; }, bal: () => T.account.find((a) => a.id === "acc1").balance };
}
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const req = (() => { let n = 0; return () => `act-${String(++n).padStart(6, "0")}-abcdef`; })();
const ringOf = (place, act, k = 0) => built.get(place).hubs.filter((h) => h.act === act)[k] ?? (() => { throw new Error(`no ${act} in ${place}`); })();
/** Enter by the door (the first position must be there), then walk to a ring (takes real time at walking speed). */
async function enter(w, place, h) {
  const sp = built.get(place).comp.spawn; w.c.placeId = place; w.c.inPlace = ""; w.c.inAt = null;
  await S.report(w.db, "u1", { x: sp.x, z: sp.z, floor: 0 });
  if (h) await walkTo(place, h);
}
let cur; // the world the current test uses
async function walkTo(place, h) { clock += 40_000; return S.report(cur.db, "u1", { x: h.x, z: h.z, floor: h.floor }); }
const at = (h) => ({ x: h.x, z: h.z, floor: h.floor });
const go = async (w, place, h) => { cur = w; await enter(w, place, h); };

try {
  // ---- the safe hustle, only inside Oduduwa Hall, only beside its ring
  { const w = world(); cur = w; const h = ringOf("oduduwa", "event_gig"), sp = built.get("oduduwa").comp.spawn, farH = [...built.get("oduduwa").hubs].sort((p, q) => Math.hypot(q.x - sp.x, q.z - sp.z) - Math.hypot(p.x - sp.x, p.z - sp.z))[0];
    // remote: the player is on the map at another place and names a ring of Oduduwa Hall
    w.c.placeId = "library"; let e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && e.status === 404, "a ring of another building cannot be used from here");
    // right place, but never walked in: the first position must be at the door
    w.c.placeId = "oduduwa"; w.c.inPlace = ""; e = await err(S.startActivity(w.db, "u1", { hubId: farH.id, requestId: req(), ...at(farH) })); assert.ok(e && /door/i.test(e.message), "teleporting to the ring is refused: " + e?.message);
    await S.report(w.db, "u1", { x: sp.x, z: sp.z, floor: 0 });
    e = await err(S.startActivity(w.db, "u1", { hubId: farH.id, requestId: req(), ...at(farH) })); assert.ok(e && /too fast|far/i.test(e.message), "jumping to the ring in no time is refused: " + e?.message);
    assert.equal(w.T.activityRun.length, 0, "nothing was recorded");
    e = await err(S.report(w.db, "u1", { x: 9999, z: 9999, floor: 0 })); assert.ok(e, "a position outside the building is refused");
    e = await err(S.report(w.db, "u1", { x: "a", z: null })); assert.ok(e, "nonsense positions are refused");
    clock += 40_000; await S.report(w.db, "u1", at(h)); // walked there
    const rid = req(), s = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: rid, ...at(h) }); assert.ok(s.started && s.sec === ACTIVITIES.event_gig.sec);
    assert.deepEqual((await S.status(w.db, "u1")).run.hubId, h.id);
    assert.equal((await S.startActivity(w.db, "u1", { hubId: h.id, requestId: rid, ...at(h) })).duplicate, true, "the same request twice starts one run"); assert.equal(w.T.activityRun.length, 1);
    e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && /busy/.test(e.message), "cannot start a second one while one runs");
    const before = w.bal(); e = await err(S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) })); assert.ok(e && /not finished/.test(e.message), "cannot finish early"); assert.equal(w.bal(), before);
    clock += ACTIVITIES.event_gig.sec * 1000 + 100; const fr = req(), f = await S.finishActivity(w.db, "u1", { requestId: fr, ...at(h) });
    assert.ok(f.ok && !f.cancelled); const earned = BigInt(f.earnedKobo); assert.ok(earned >= N(1_500) && earned <= N(15_000)); assert.equal(w.bal(), before + earned);
    assert.equal((await S.finishActivity(w.db, "u1", { requestId: fr, ...at(h) })).duplicate, true, "finishing twice pays once"); assert.equal(w.bal(), before + earned);
    assert.equal(w.T.activityRun[0].status, "DONE");
    // straight away again: the existing 6 hour break applies
    e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && e.status === 429 && /6 hour/.test(e.message), "the 6 hour gap still holds: " + e?.message);
    // and the status says so, with no offer
    assert.ok((await S.status(w.db, "u1")).hubs.find((q) => q.id === h.id).blocked);
    // the old home-screen route no longer exists for the hustle: the route itself refuses (see src/app/api/action/route.js); the service call keeps working for the tests only
    // walking away cancels a run
    clock += 6 * H + MIN; const s2 = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); assert.ok(s2.started);
    const far = built.get("oduduwa").hubs.find((q) => q.id !== h.id && Math.hypot(q.x - h.x, q.z - h.z) > PRESENCE.stayRadius + 1);
    clock += 30_000; const rr = await S.report(w.db, "u1", at(far)); assert.equal(rr.cancelled, "event_gig"); assert.equal(w.T.activityRun.at(-1).status, "CANCELLED");
    e = await err(S.finishActivity(w.db, "u1", { requestId: req(), ...at(far) })); assert.ok(e && /nothing to finish/.test(e.message));
    // walking away without reporting, then finishing: no reward
    clock += 6 * H + MIN; await S.report(w.db, "u1", at(h)); const s3 = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); assert.ok(s3.started);
    clock += 61_000; const bal = w.bal(); const out = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(far) }); assert.ok(out.cancelled && /walked away/.test(out.message)); assert.equal(w.bal(), bal, "no pay for walking off");
    // leaving the building (travelling elsewhere) while it runs
    clock += 6 * H + MIN; await S.report(w.db, "u1", at(h)); await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); w.c.placeId = "library"; clock += 61_000;
    const out2 = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) }); assert.ok(out2.cancelled && /left/.test(out2.message)); chk("the safe hustle works only at the ring, once, after its time, and not from elsewhere", true); }

  // ---- the risky hustle belongs to the SUB
  { const w = world({ luck: 100 }); const h = ringOf("sub", "back_room_deal"); await go(w, "sub", h);
    let e = await err(S.startActivity(w.db, "u1", { hubId: ringOf("sub", "play_games").id, requestId: req(), ...at(h) })); assert.ok(e, "the ring you are not beside is too far");
    const s = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); assert.ok(s.started); clock += ACTIVITIES.back_room_deal.sec * 1000 + 100;
    const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) }); assert.ok(f.ok); assert.ok(f.caught === true || BigInt(f.earnedKobo) >= N(100_000), "risky is paid or the player is caught");
    if (f.caught) { assert.ok(w.c.jailedUntil); assert.equal(w.c.placeId, "floor0", "a caught player is moved to Floor O"); }
    chk("the risky hustle runs inside the SUB", true); }
  { const w = world(); await go(w, "oduduwa", ringOf("oduduwa", "event_gig")); const e = await err(S.startActivity(w.db, "u1", { hubId: ringOf("sub", "back_room_deal").id, requestId: req(), ...at(ringOf("oduduwa", "event_gig")) })); assert.ok(e && e.status === 404, "the risky hustle cannot be started in Oduduwa Hall"); }

  // ---- sleeping: your own bed, tiredness, cooldown, daily limit, budget
  { const w = world({ hostel: "Awo", energy: 30, health: 70, placeId: "h_awo" }); const beds = built.get("h_awo").hubs.filter((h) => h.act === "sleep_bed"), h = beds[0];
    await go(w, "h_awo", h);
    const s = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); assert.ok(s.started); clock += ACTIVITIES.sleep_bed.sec * 1000 + 100;
    const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) }); assert.deepEqual(f.applied, { health: 2, energy: 70 }); assert.equal(w.c.energy, 100); assert.equal(w.c.health, 72);
    let e = await err(S.startActivity(w.db, "u1", { hubId: beds[1].id, requestId: req(), ...at(h) })); assert.ok(e, "another bed is too far to use from here");
    await walkTo("h_awo", beds[1]); w.c.energy = 50; e = await err(S.startActivity(w.db, "u1", { hubId: beds[1].id, requestId: req(), ...at(beds[1]) })); assert.ok(e && /Again in/.test(e.message), "a cooldown follows sleeping: " + e?.message);
    clock += 61_000; await S.report(w.db, "u1", at(beds[1])); w.c.energy = 95; e = await err(S.startActivity(w.db, "u1", { hubId: beds[1].id, requestId: req(), ...at(beds[1]) })); assert.ok(e && /not tired/.test(e.message), "not when you are not tired: " + e?.message); chk("sleeping restores energy once per cooldown and only when tired", true); }
  { const w = world({ hostel: "Fajuyi", energy: 20, placeId: "h_awo" }); const h = ringOf("h_awo", "sleep_bed"); await go(w, "h_awo", h);
    const e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && /not your room/i.test(e.message), "you cannot sleep in someone else's hall"); }
  { const w = world({ energy: 20, placeId: "blk_1a" }); const h = ringOf("blk_1a", "bunk_rest"); await go(w, "blk_1a", h); const s = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); assert.ok(s.started, "anyone can rest on a block bunk"); }
  // sleeping from empty: 0 to 100 in one 30 second sleep, and it does not use up the day's energy allowance
  { const w = world({ energy: 0, hostel: "Awo", placeId: "h_awo" }); const h = ringOf("h_awo", "sleep_bed"); await go(w, "h_awo", h);
    await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); clock += 30_000 + 100; const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) });
    assert.equal(f.applied.energy, 100); assert.equal(w.c.energy, 100); assert.equal(w.T.activityRun[0].delta.energy, undefined, "sleep does not count against the energy allowance");
    // up to 6 sleeps a day
    for (let i = 0; i < 5; i++) { clock += 61_000; w.c.energy = 10; await S.report(w.db, "u1", at(h)); await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); clock += 30_100; await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) }); }
    clock += 61_000; w.c.energy = 10; await S.report(w.db, "u1", at(h)); const e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && /times today/.test(e.message), "six sleeps a day at most"); chk("a sleep takes 30 seconds and refills energy", true); }

  // ---- paying: fees go through the ledger, and a player who cannot pay starts nothing
  { const w = world({ energy: 50, placeId: "new_bukateria" }); const h = ringOf("new_bukateria", "eat_meal"); await go(w, "new_bukateria", h); const before = w.bal();
    await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); assert.equal(w.bal(), before - N(1500), "the fee is taken at the start"); assert.equal(w.T.account.find((a) => a.id === "v").balance, 0n, "system balances are derived from the ledger");
    assert.equal(w.T.ledgerEntry.length, 1); clock += ACTIVITIES.eat_meal.sec * 1000 + 100; const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) }); assert.equal(f.applied.energy, 12); assert.equal(w.bal(), before - N(1500), "nothing more is taken"); }
  { const w = world({ energy: 50, placeId: "new_bukateria" }); w.T.account[0].balance = N(100); const h = ringOf("new_bukateria", "eat_meal"); await go(w, "new_bukateria", h);
    const e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && e.status === 402, "cannot afford"); assert.equal(w.T.activityRun.length, 0, "a refused start leaves no run behind"); assert.equal(w.T.ledgerEntry.length, 0); }

  // ---- health only when hurt
  { const w = world({ health: 95, placeId: "health_centre" }); const h = ringOf("health_centre", "health_checkup"); await go(w, "health_centre", h);
    let e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && /good health/.test(e.message)); w.c.health = 40;
    await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); clock += ACTIVITIES.health_checkup.sec * 1000 + 100; const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) }); assert.equal(f.applied.health, 8, "health +10 but only 8 a day from activities: the budget cuts it"); assert.deepEqual(f.capped, ["health"]); }

  // ---- classes, a test and the exam: a course must be named, position must be right, the existing rules apply
  { const w = world({ placeId: "f_science", energy: 100 }); const hc = ringOf("f_science", "attend_class"); await go(w, "f_science", hc);
    const st = await S.status(w.db, "u1"); assert.equal(st.courses.length, 4, "the player's own four courses are offered"); const code = st.courses[0].code;
    let e = await err(S.startActivity(w.db, "u1", { hubId: hc.id, requestId: req(), ...at(hc) })); assert.ok(e && e.status === 400, "a lecture needs a course");
    e = await err(S.startActivity(w.db, "u1", { hubId: hc.id, requestId: req(), ...at(hc), param: "LAW 101" })); assert.ok(e && e.status === 400, "and it must be one of yours");
    await S.startActivity(w.db, "u1", { hubId: hc.id, requestId: req(), ...at(hc), param: code }); clock += ACTIVITIES.attend_class.sec * 1000 + 100; const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(hc) }); assert.match(f.note, /lecture/);
    assert.equal(w.T.courseProgress[0].attended, 1); assert.equal(w.c.energy, 88, "the lecture costs the 12 energy the Courses rules say");
    clock += ACTIVITIES.attend_class.cd * 1000 + 100; await S.report(w.db, "u1", at(hc));
    e = await err(S.startActivity(w.db, "u1", { hubId: hc.id, requestId: req(), ...at(hc), param: code })); assert.ok(e && /already attended/.test(e.message), "once per course per week: " + e?.message);
    // a test
    const ht = ringOf("f_science", "class_test"); await walkTo("f_science", ht);
    await S.startActivity(w.db, "u1", { hubId: ht.id, requestId: req(), ...at(ht), param: code }); clock += ACTIVITIES.class_test.sec * 1000 + 100; const tf = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(ht) }); assert.ok(tf.score >= 0 && tf.score <= 20 && tf.outOf === 20, "a score out of 20");
    e = await err(S.startActivity(w.db, "u1", { hubId: ht.id, requestId: req(), ...at(ht), param: code })); assert.ok(e && /this week/.test(e.message), "one class test a week");
    // the exam: week 6 of a player who joined in week 1 (the fixture's clock puts the game in week 1, so the exam is refused)
    const he = ringOf("f_science", "sit_exam"); await walkTo("f_science", he);
    e = await err(S.startActivity(w.db, "u1", { hubId: he.id, requestId: req(), ...at(he) })); assert.ok(e && /no exam this week/.test(e.message), "no exam outside exam weeks");
    chk("classes and tests follow the course rules", true); }
  { const w = world({ placeId: "lt_1000", energy: 100, joinedWeek: -4 }); // joined 5 weeks before week 1: this is week 6 of study
    const he = ringOf("lt_1000", "sit_exam"); await go(w, "lt_1000", he);
    await S.startActivity(w.db, "u1", { hubId: he.id, requestId: req(), ...at(he), param: "" }); clock += ACTIVITIES.sit_exam.sec * 1000 + 100; const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(he) });
    assert.ok(f.ok && f.score >= 0 && f.gradePoint >= 0, "the exam is sat in a lecture theatre"); assert.equal(w.T.examResult.length, 1);
    clock += ACTIVITIES.sit_exam.cd * 1000 + 100 + DAY; const e = await err(S.startActivity(w.db, "u1", { hubId: he.id, requestId: req(), ...at(he) })); assert.ok(e && /already sat|no exam/.test(e.message), "one exam a week: " + e?.message); }

  // ---- nightlife needs the week's ticket for that club
  { const w = world({ placeId: "club_quantum", energy: 100 }); const h = ringOf("club_quantum", "dance"); await go(w, "club_quantum", h);
    let e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && /ticket/.test(e.message), "no ticket, no dancing");
    const wk = (await S.status(w.db, "u1")).now ? 1 : 1; w.T.partyTicket.push({ id: 1n, characterId: "c1", venue: "Quantum", gameWeek: Math.floor((clock - START) / (7 * DAY)) + 1, pricePaid: N(20_000) });
    const s = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(s === null || !/ticket/.test(s.message), "with this week's ticket the ring works: " + s?.message); }

  // ---- the cells are for people in custody
  { const w = world({ placeId: "floor0", energy: 40 }); const h = ringOf("floor0", "cell_bunk"); await go(w, "floor0", h); const e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e && /sentence/.test(e.message), "a free visitor cannot use the cells");
    w.c.jailedUntil = new Date(clock + 40 * MIN); const s = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); assert.ok(s.started, "a prisoner can rest in the cell"); }
  { const w = world({ placeId: "oduduwa", jailedUntil: new Date(clock + 40 * MIN) }); const h = ringOf("oduduwa", "event_gig"); await go(w, "oduduwa", h); const e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); assert.ok(e, "no activities while in custody (except the cells)"); }

  // ---- bad input
  { const w = world(); const h = ringOf("oduduwa", "event_gig"); await go(w, "oduduwa", h);
    for (const bad of ["", "nope", "event_gig", "event_gig:99", "__proto__:0", "sleep_bed:0"]) { const e = await err(S.startActivity(w.db, "u1", { hubId: bad, requestId: req(), ...at(h) })); assert.ok(e, `"${bad}" is refused`); }
    const e = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: "x", ...at(h) })); assert.ok(e && e.status === 400, "a missing requestId is refused"); assert.equal(w.T.activityRun.length, 0); }
  // a place that stays outdoors has no rings, whatever the player says
  { const w = world({ placeId: "main_bowl" }); const e = await err(S.report(w.db, "u1", { x: 0, z: 0, floor: 0 })); assert.ok(e && /not inside a building/.test(e.message)); }
} finally { Date.now = realNow; }

console.log(bad ? `\n${bad} check(s) failed` : "\nAll activity checks passed"); process.exit(bad ? 1 : 0);
