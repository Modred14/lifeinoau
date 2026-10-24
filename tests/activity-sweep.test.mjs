// tests/activity-sweep.test.mjs: EVERY activity in the catalogue, driven end to end through the real server service (report -> status -> start -> finish)
// against the in-memory database. The existing tests/tests__activities.test.mjs checks the rules and a handful of flows in depth; this one makes sure that no
// activity is left unverified: each one is started from its own ring in a real building, pays what it says, gives what it says, can be neither paid twice
// nor claimed twice, is refused for the right reasons, and is cancelled (with no reward) when the player walks away.
import assert from "node:assert/strict";
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { classify, buildInterior } from "../lib3d/interiors/index.js";
import { activityHubs } from "../lib3d/interiors/activityHubs.js";
import { ACTIVITIES, PRESENCE, effectsOf, budgeted, apply } from "../lib/activities.js";
import { ACTIVITY_MS } from "../lib/activityTime.js";
import { makeDb } from "./fakedb.mjs";
import * as S from "../lib/activityService.js";
import { cellsOf, cellFor, inCell } from "../lib/custodyCells.js";

let bad = 0; const chk = (l, c, more) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && more ? "\n     " + more : "")); };

// ---- the real buildings and their rings
const d = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const all = new Map(); for (const l of LANDMARKS) all.set(l.id, { id: l.id, name: l.name, kind: l.kind }); for (const p of d.places) all.set(p.id, { id: p.id, name: p.name, kind: p.kind });
const built = new Map();
for (const p of all.values()) { const c = classify(p.id, p.kind); if (c.mode !== "interior") continue; const comp = buildInterior(p); built.set(p.id, { p, comp, ...activityHubs(comp, c.spec) }); }
/** The first building (in a fixed order) that has a ring for `act`, and that ring. `prefer` names a building to use when it has one. */
const where = (act, prefer) => { for (const id of [prefer, ...built.keys()]) { const b = built.get(id); const h = b?.hubs.find((q) => q.act === act); if (h) return { place: id, ring: h, b }; } return null; };

// ---- the world
const H = 3_600_000, MIN = 60_000, DAY = 24 * H, N = (n) => BigInt(n) * 100n;
const START = Date.UTC(2026, 9, 1, 15, 30);
const DAYTIME = START + 5 * DAY + H, NIGHT = Date.UTC(2026, 9, 6, 21, 30); // the clubs only open from 8 PM to 5 AM game time
const realNow = Date.now; let clock = DAYTIME; Date.now = () => clock;
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "achievementAward", "business", "holding", "partyTicket", "bond", "activityRun", "courseProgress", "clubVip", "clubBuyout", "clubEvent", "clubTransaction", "block"];
const FACULTY = { name: "Science", difficulty: 1.1 };
function world(over = {}) {
  const db = makeDb(models, { unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"], activityRun: ["characterId", "requestId"], examResult: ["characterId", "gameWeek"] }, join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.characterId === r.id), faculty: FACULTY }) } });
  const T = db.T();
  T.account.push({ id: "acc1", kind: "PLAYER", systemName: null, characterId: "c1", balance: N(1_000_000) }, { id: "w", kind: "SYSTEM", systemName: "WORLD", balance: 0n }, { id: "v", kind: "SYSTEM", systemName: "VENUES", balance: 0n }, { id: "d", kind: "SYSTEM", systemName: "DSA", balance: 0n });
  T.gameClock.push({ id: 1, startedAt: new Date(START) });
  T.character.push({ id: "c1", userId: "u1", name: "Tester", hostel: "Awo", expelled: false, suspendedUntilWeek: 0, jailedUntil: null, strikes: 0, energy: 50, health: 40, happiness: 50, academics: 40, popularity: 10, suspicion: 0, luck: 50, personalities: [], lastTickWeek: 9999, joinedWeek: 1, sessionStartWeek: 1, level: 100, class: "LAPO", placeId: "oduduwa", energyRefilledAt: new Date(clock), inPlace: "", inX: null, inZ: null, inFloor: 0, inAt: null, ...over });
  return { db, T, get c() { return T.character[0]; }, bal: () => T.account.find((a) => a.id === "acc1").balance };
}
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const req = (() => { let n = 0; return () => `sweep-${String(++n).padStart(6, "0")}-abcdef`; })();
const at = (h) => ({ x: h.x, z: h.z, floor: h.floor });
/** Come in by the door, then walk to the ring (real time at walking speed passes, so the server's speed check is honoured). */
async function arrive(w, place, h) {
  const sp = built.get(place).comp.spawn; w.c.placeId = place; w.c.inPlace = ""; w.c.inAt = null;
  await S.report(w.db, "u1", { x: sp.x, z: sp.z, floor: 0 }); clock += 60_000; await S.report(w.db, "u1", at(h));
}

// ---- how each activity is set up so that it is eligible (anything not listed uses the plain default: tired, hurt, rich)
const SETUP = {
  sleep_bed: { prefer: "h_awo", char: { hostel: "Awo", energy: 30 } },
  attend_class: { prefer: "f_science", course: true }, study_course: { prefer: "f_science", course: true }, class_test: { prefer: "f_science", course: true },
  sit_exam: { prefer: "lt_1000", char: { joinedWeek: -4, energy: 100 }, param: "" },
  club: { night: true, char: { energy: 100 } },
  event_gig: { char: { energy: 100 } }, back_room_deal: { char: { energy: 100, luck: 100 } },
};
for (const a of ["dance", "club_drink", "vip_mingle", "patio_chat"]) SETUP[a] = SETUP.club;

const results = [];
for (const [act, def] of Object.entries(ACTIVITIES)) {
  if (def.inmate) continue; // the cells are for prisoners: swept below
  const su = SETUP[act] ?? {}, loc = where(act, su.prefer);
  if (!loc) { chk(`${act}: it stands in some real building`, false); continue; }
  clock = su.night ? NIGHT : DAYTIME;
  const w = world({ placeId: loc.place, ...su.char });
  const { place, ring: h } = loc;
  await arrive(w, place, h);

  // 1. what the screen is shown: the ring is offered, it is not blocked for this player, and the server describes it
  const st = await S.status(w.db, "u1"), view = st.hubs.find((q) => q.id === h.id);
  chk(`${act} @ ${place}: the server offers its ring (${h.id}) with a name, a summary and a time`, !!view && !!view.label && !!view.sub && view.sec === def.sec, JSON.stringify(view));
  chk(`${act}: nothing blocks an eligible player (what the screen shows is what the server allows)`, view && !view.blocked, view?.blocked);
  const param = su.course ? st.courses[0].code : su.param;

  // 2. start: the fee is taken once, a run is recorded, the same request again changes nothing
  const before = { ...w.c }, balBefore = w.bal(), rid = req();
  const s = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: rid, ...at(h), param });
  chk(`${act}: it starts, takes ${def.cost ? "₦" + def.cost : "no fee"} and lasts ${def.sec}s`, s.started && s.sec === def.sec && w.bal() === balBefore - N(def.cost ?? 0), JSON.stringify(s));
  const dup = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: rid, ...at(h), param });
  chk(`${act}: pressing Start twice starts one run and takes one fee`, dup.duplicate === true && w.T.activityRun.length === 1 && w.bal() === balBefore - N(def.cost ?? 0) && w.T.ledgerEntry.length === (def.cost ? 1 : 0));
  const busy = await err(S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h), param }));
  chk(`${act}: a second run cannot start while one is running`, busy && /busy/.test(busy.message), busy?.message);
  const early = await err(S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) }));
  chk(`${act}: it cannot be finished early`, early && /not finished/.test(early.message), early?.message);

  // 3. finish: the result is what the catalogue says, and claiming twice pays once
  clock += ACTIVITY_MS + 100; const fid = req(), f = await S.finishActivity(w.db, "u1", { requestId: fid, ...at(h) });
  chk(`${act}: it finishes with a message`, f.ok && !f.cancelled && !!(f.note ?? f.message), JSON.stringify(f).slice(0, 200));
  if (def.kind === "stats") {
    const { d: want } = effectsOf(before, def), { d: got } = budgeted(want, { energy: 0, health: 0, happiness: 0, academics: 0, popularity: 0 }); if (def.full && want.energy) got.energy = want.energy;
    const { applied } = apply(before, got);
    chk(`${act}: the stats change exactly as promised ${JSON.stringify(applied)}`, JSON.stringify(Object.entries(f.applied).sort()) === JSON.stringify(Object.entries(applied).sort()) && Object.entries(applied).every(([k, v]) => w.c[k] === before[k] + v), `server ${JSON.stringify(f.applied)} wanted ${JSON.stringify(applied)}`);
  } else if (def.kind === "hustle_safe") chk(`${act}: pays ₦1,500 to ₦15,000`, BigInt(f.earnedKobo) >= N(1_500) && BigInt(f.earnedKobo) <= N(15_000) && w.bal() === balBefore + BigInt(f.earnedKobo));
  else if (def.kind === "hustle_risky") chk(`${act}: pays a lot, or the player is caught and held`, f.caught ? !!w.c.jailedUntil && w.c.placeId === "floor0" : BigInt(f.earnedKobo) >= N(100_000));
  else if (def.kind === "course_test") chk(`${act}: scores out of 20`, f.score >= 0 && f.score <= 20 && f.outOf === 20);
  else if (def.kind === "exam") chk(`${act}: gives a score and a grade point and records the result`, f.score >= 0 && f.gradePoint >= 0 && w.T.examResult.length === 1);
  else chk(`${act}: records the course (${def.kind})`, /lecture|stud/i.test(f.note ?? "") && w.T.courseProgress.length === 1, f.note);
  const afterBal = w.bal(), again = await S.finishActivity(w.db, "u1", { requestId: fid, ...at(h) });
  chk(`${act}: claiming the reward twice pays once`, again.duplicate === true && w.bal() === afterBal && w.T.activityRun[0].status === "DONE");

  // 4. refusals: not enough money (nothing starts, nothing is taken), the wrong building, a missing prerequisite
  if (!def.kind.startsWith("hustle") && def.cost) {
    const p2 = world({ placeId: place, ...su.char }); p2.T.account[0].balance = 100n; await arrive(p2, place, h);
    const e = await err(S.startActivity(p2.db, "u1", { hubId: h.id, requestId: req(), ...at(h), param }));
    chk(`${act}: without ₦${def.cost} it is refused ("cannot afford") and leaves nothing behind`, e && e.status === 402 && p2.T.activityRun.length === 0 && p2.T.ledgerEntry.length === 0 && p2.bal() === 100n, e?.message);
  }
  { const other = [...built.keys()].find((id) => id !== place && !built.get(id).hubs.some((q) => q.id === h.id && q.act === act)), p3 = world({ placeId: other, ...su.char }); await arrive(p3, other, built.get(other).hubs[0]);
    const e = await err(S.startActivity(p3.db, "u1", { hubId: h.id, requestId: req(), ...at(built.get(other).hubs[0]), param }));
    chk(`${act}: its ring cannot be used from another building`, e && (e.status === 404 || e.status === 409), e?.message); }
  if (su.char?.energy == null && !def.full && !def.home && !def.need?.maxEnergy && def.kind === "stats" && -(def.d.energy ?? 0) > 0) {
    const p4 = world({ placeId: place, energy: 0, ...(su.char ?? {}), ...{ energy: 0 } }); await arrive(p4, place, h);
    const e = await err(S.startActivity(p4.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }));
    chk(`${act}: with no energy it is refused ("too tired") and costs nothing`, e && /tired/.test(e.message) && p4.T.activityRun.length === 0 && p4.T.ledgerEntry.length === 0, e?.message);
  }

  // 5. walking away from a running activity cancels it and pays nothing (only for activities that run on the same spot, i.e. every one)
  { const p5 = world({ placeId: place, ...su.char }); await arrive(p5, place, h); const b5 = p5.bal();
    const s5 = await S.startActivity(p5.db, "u1", { hubId: h.id, requestId: req(), ...at(h), param }); assert.ok(s5.started, `${act} must start for the walk-away check`);
    const far = [...built.get(place).hubs].sort((p, q) => Math.hypot(q.x - h.x, q.z - h.z) - Math.hypot(p.x - h.x, p.z - h.z)).find((q) => q.floor === h.floor && Math.hypot(q.x - h.x, q.z - h.z) > PRESENCE.stayRadius + 1);
    if (far) { clock += 40_000; const r5 = await S.report(p5.db, "u1", at(far)); const paid = def.cost ? N(def.cost) : 0n;
      chk(`${act}: walking away cancels it, and no reward is paid`, r5.cancelled === act && p5.T.activityRun.at(-1).status === "CANCELLED" && p5.bal() === b5 - paid && p5.c.energy === (su.char?.energy ?? 50) , JSON.stringify(r5)); }
  }
  results.push(act);
}
chk(`every activity that is not a cell activity was swept (${results.length})`, results.length === Object.values(ACTIVITIES).filter((a) => !a.inmate).length);

// ---- the cells (people serving a sentence)
{ const cells = cellsOf(built.get("floor0").comp), mine = cellFor(cells, "c1");
  for (const act of ["cell_bunk", "cell_pushups"]) { clock = DAYTIME;
    const h = built.get("floor0").hubs.find((q) => q.act === act && inCell(mine, q.x, q.z)); assert.ok(h, `${act}: a ring in the prisoner's own cell`);
    const w = world({ placeId: "floor0", energy: 50, jailedUntil: new Date(clock + 40 * MIN) }); await S.report(w.db, "u1", at(h));
    const view = (await S.status(w.db, "u1")).hubs.find((q) => q.id === h.id); chk(`${act}: a prisoner is offered it and it is not blocked`, view && !view.blocked, view?.blocked);
    const s = await S.startActivity(w.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); clock += ACTIVITY_MS + 100; const f = await S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) });
    const { d: want } = effectsOf(w.T.character[0], ACTIVITIES[act]); chk(`${act}: it runs in custody and changes the stats`, s.started && f.ok && Object.keys(f.applied).length > 0, JSON.stringify(f.applied) + " " + JSON.stringify(want));
    // a free player is not offered the cells and cannot use them
    const free = world({ placeId: "floor0", energy: 50 }); await S.report(free.db, "u1", { x: built.get("floor0").comp.spawn.x, z: built.get("floor0").comp.spawn.z, floor: 0 });
    const fv = (await S.status(free.db, "u1")).hubs.find((q) => q.id === h.id); chk(`${act}: a free player is not shown the cells`, !fv); } }

// ---- ordinary activities are refused to a prisoner (custody forbids them), with a clear reason
{ clock = DAYTIME; const w = world({ placeId: "floor0", jailedUntil: new Date(clock + 40 * MIN) }); const cells = cellsOf(built.get("floor0").comp), mine = cellFor(cells, "c1");
  const h = built.get("floor0").hubs.find((q) => q.act === "cell_bunk" && inCell(mine, q.x, q.z)); await S.report(w.db, "u1", at(h));
  const e = await err(S.startActivity(w.db, "u1", { hubId: where("buy_snack").ring.id, requestId: req(), ...at(h) })); chk("a prisoner cannot start an ordinary activity", !!e, e?.message); }

// ---- invalid payloads and API-level failures
{ clock = DAYTIME; const { place, ring: h } = where("buy_snack"); const w = world({ placeId: place }); await arrive(w, place, h);
  for (const [name, body] of [["no requestId", { hubId: h.id, ...at(h) }], ["empty hubId", { hubId: "", requestId: req(), ...at(h) }], ["non-numeric position", { hubId: h.id, requestId: req(), x: "1", z: "2", floor: 0 }], ["NaN position", { hubId: h.id, requestId: req(), x: NaN, z: NaN, floor: 0 }], ["position outside the building", { hubId: h.id, requestId: req(), x: 9999, z: 9999, floor: 0 }], ["a floor that does not exist", { hubId: h.id, requestId: req(), x: h.x, z: h.z, floor: 7 }], ["a very long requestId", { hubId: h.id, requestId: "x".repeat(200), ...at(h) }]]) {
    const e = await err(S.startActivity(w.db, "u1", body)); chk(`start with ${name} is refused with a message and starts nothing`, e && !!e.message && e.status >= 400 && w.T.activityRun.length === 0, e?.message); }
  const e = await err(S.finishActivity(w.db, "u1", { requestId: req(), ...at(h) })); chk("finishing when nothing runs says so", e && /nothing to finish/.test(e.message), e?.message);
  const c = await S.cancelActivity(w.db, "u1"); chk("cancelling when nothing runs is harmless", c.ok && c.cancelled === 0);
  // a failed charge (the fee could not be taken) leaves no run behind, and a retry afterwards works
  const poor = world({ placeId: place, energy: 50 }); poor.T.account[0].balance = 0n; await arrive(poor, place, h);
  const e2 = await err(S.startActivity(poor.db, "u1", { hubId: h.id, requestId: req(), ...at(h) })); poor.T.account[0].balance = N(10_000);
  const s2 = await S.startActivity(poor.db, "u1", { hubId: h.id, requestId: req(), ...at(h) }); chk("a refused payment starts nothing, and once the money is there it works", e2 && e2.status === 402 && s2.started && poor.T.activityRun.length === 1); }

Date.now = realNow;
console.log(bad ? `\n${bad} check(s) failed` : "\nEvery activity ran end to end"); process.exit(bad ? 1 : 0);
