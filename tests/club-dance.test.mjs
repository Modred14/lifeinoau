// tests/club-dance.test.mjs: club dancing (server side), run for ALL THREE clubs through the real service against the in-memory database.
// Proves: dancing works in each club, is refused outside a club / while an activity runs / for an unknown style, costs nothing, renews and stops,
// shows to other players only while the lease lives, in the right place, and never to someone who has blocked you.
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
const models = ["character", "account", "actionLog", "ledgerEntry", "floorZero", "gameClock", "notification", "achievement", "examResult", "achievementAward", "business", "holding", "partyTicket", "bond", "activityRun", "courseProgress", "classTest", "clubVip", "clubBuyout", "clubEvent", "clubTransaction", "block"];
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

// ---- the checks
const { shapePeople } = await import("../lib/playerPresence.js");
const { DANCE_STYLES, DANCE_LEASE_SEC } = await import("../lib/danceStyles.js");
const CLUBS = ["club_quantum", "club_0203", "club_divas"];
const dancing = (w) => w.c.danceStyle ?? null;
for (const id of CLUBS) {
  if (!built.has(id)) { chk(`${id}: the club interior exists`, false); continue; }
  clock = NIGHT; const w = world({ placeId: id }), sp = built.get(id).comp.spawn, cash = w.bal();
  w.c.inPlace = ""; w.c.inAt = null;
  await S.report(w.db, "u1", { x: sp.x, z: sp.z, floor: 0 });
  for (const st of DANCE_STYLES) {
    clock += 2_000; const r = await S.setDance(w.db, "u1", { style: st.id, x: sp.x, z: sp.z, floor: 0 });
    chk(`${id}: "${st.label}" starts`, r.ok && r.dancing === st.id && dancing(w) === st.id);
  }
  chk(`${id}: dancing cost nothing`, w.bal() === cash);
  const first = +w.c.danceUntil; clock += 8_000; await S.setDance(w.db, "u1", { style: "oblee", x: sp.x, z: sp.z, floor: 0 });
  chk(`${id}: asking again renews the lease`, +w.c.danceUntil > first && +w.c.danceUntil - clock === DANCE_LEASE_SEC * 1000);
  // what another player sees
  const row = () => ({ ...w.c, id: "c1", name: "Tester", gender: "F", level: 100 }), see = () => shapePeople({ rows: [row()], selfId: "other", placeId: id, now: clock });
  let seen = see()[0];
  chk(`${id}: another player sees the Ọ̀blee clip, in the right spot`, seen?.dance === "oblee" && seen.anim?.[0] === "danceOblee" && Number.isFinite(seen.x));
  chk(`${id}: nobody sees it in a different building`, shapePeople({ rows: [row()], selfId: "other", placeId: "floor0", now: clock })[0]?.anim == null);
  chk(`${id}: nobody who has blocked you sees it`, shapePeople({ rows: [row()], blocks: [{ blockerId: "other", blockedId: "c1" }], selfId: "other", placeId: id, now: clock }).length === 0);
  const t0 = clock; clock = +w.c.danceUntil + 1; chk(`${id}: when the dancer's screen stops renewing, the dance ends by itself`, see()[0]?.anim == null); clock = t0;
  // stopping
  const r = await S.setDance(w.db, "u1", { style: null }); chk(`${id}: stopping clears it at once`, r.dancing === null && dancing(w) === null && see()[0]?.anim == null);
  chk(`${id}: stopping when not dancing is harmless`, (await S.setDance(w.db, "u1", { style: "" })).ok);
  // refusals
  const e1 = await err(S.setDance(w.db, "u1", { style: "moonwalk", x: sp.x, z: sp.z, floor: 0 })); chk(`${id}: an unknown style is refused`, e1?.status === 400 && dancing(w) === null);
  const e2 = await err(S.setDance(w.db, "u1", { style: "../x", x: sp.x, z: sp.z, floor: 0 })); chk(`${id}: a junk style is refused`, e2?.status === 400);
  const e3 = await err(S.setDance(w.db, "u1", { style: "oblee", x: 9999, z: 9999, floor: 0 })); chk(`${id}: claiming to dance from outside the room is refused`, !!e3 && dancing(w) === null);
  const jailed = world({ placeId: id, jailedUntil: new Date(clock + 40 * MIN) }); jailed.c.inPlace = ""; jailed.c.inAt = null;
  const e4 = await err(S.setDance(jailed.db, "u1", { style: "oblee", x: sp.x, z: sp.z, floor: 0 })); chk(`${id}: someone being held cannot dance`, !!e4 && dancing(jailed) === null);
}
// every club has the same shared activities, each at a ring inside its own hall
for (const id of CLUBS) { const acts = built.get(id).hubs.map((h) => h.act); for (const a of ["dance", "club_drink", "club_mingle"]) chk(`${id}: has a "${a}" ring`, acts.includes(a)); }
const spots = CLUBS.map((id) => { const h = built.get(id).hubs.find((q) => q.act === "club_mingle"); return `${h.x.toFixed(1)},${h.z.toFixed(1)}`; });
chk("the mingle ring sits at a different spot in each club (layouts are not copied)", new Set(spots).size === 3);
// not a club
{ const other = [...built.keys()].find((k) => !CLUBS.includes(k) && !k.startsWith("club")); clock = NIGHT; const w = world({ placeId: other }), sp = built.get(other).comp.spawn; w.c.inPlace = ""; w.c.inAt = null;
  await S.report(w.db, "u1", { x: sp.x, z: sp.z, floor: 0 });
  const e = await err(S.setDance(w.db, "u1", { style: "oblee", x: sp.x, z: sp.z, floor: 0 })); chk(`dancing is refused outside a club (${other})`, e?.status === 409 && dancing(w) === null); }
// an activity running blocks a dance, and starting an activity ends one
{ clock = NIGHT; const id = "club_quantum", b = built.get(id), ring = b.hubs.find((h) => h.act === "club_drink") ?? b.hubs[0], w = world({ placeId: id }); w.c.inPlace = ""; w.c.inAt = null;
  await arrive(w, id, ring); await S.setDance(w.db, "u1", { style: "bounce", ...at(ring) }); chk("a dance is on before an activity starts", dancing(w) === "bounce");
  const r = await S.startActivity(w.db, "u1", { hubId: ring.id, requestId: req(), ...at(ring) }); chk("starting an activity ends the dance", r.ok && dancing(w) === null);
  const e = await err(S.setDance(w.db, "u1", { style: "bounce", ...at(ring) })); chk("while an activity runs you cannot start a dance", e?.status === 409 && dancing(w) === null); }
Date.now = realNow;
console.log(bad ? `\n${bad} check(s) failed` : "\nAll club dance checks passed"); process.exit(bad ? 1 : 0);
