// tests/custody.test.mjs: the visible, enforced custody cells (lib/custodyCells.js), who is seen where (lib/playerPresence.js), and the police and custody animations.
// The server rule for reports (a prisoner only inside their own cell; nobody else inside any cell) is also exercised end to end in tests/tests__activities.test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { interiorOf } from "../lib/activityService.js";
import { CUSTODY_PLACE, isJailed } from "../lib/discipline.js";
import { cellsOf, cellFor, cellAt, inCell, clampToCell, cellSpot, custodyPlacement, hashOf, CELL_MARGIN } from "../lib/custodyCells.js";
import { shapePeople } from "../lib/playerPresence.js";
import { POLICE_CLIPS, POLICE_SEATED } from "../lib3d/avatar/policeClips.js";
import { ACTIVITIES } from "../lib/activities.js";

const inside = interiorOf(CUSTODY_PLACE), cells = cellsOf(inside.compiled);
assert.equal(cells.length, 4, "the custody building has four cells"); assert.deepEqual(cells.map((c) => c.id), ["cell1", "cell2", "cell3", "cell4"]);
for (const c of cells) assert.ok(c.x1 > c.x0 && c.z1 > c.z0 && inCell(c, c.cx, c.cz), c.id + " has a real area");

// ---- every cell has its own rings, so whichever cell a prisoner is held in they can rest and exercise
assert.deepEqual(inside.missing, [], "no activity ring is missing");
for (const c of cells) for (const act of ["cell_bunk", "cell_pushups"]) assert.ok(inside.hubs.some((h) => h.act === act && inCell(c, h.x, h.z)), `${c.id} has a ${act} ring`);

// ---- the bars are drawn across every cell door and are not solid in the shared plan (they are enforced by the server and the scene instead)
const bars = inside.compiled.items.filter((i) => i.type === "bars");
assert.equal(bars.length, 4, "one set of bars per cell"); for (const b of bars) assert.ok(cells.some((c) => b.z <= c.z1 + 0.01 && b.z >= c.z1 - 0.3 && b.x > c.x0 && b.x < c.x1), "the bars stand in a cell doorway");

// ---- assignment: stable, spread out, and always one of the cells
const ids = Array.from({ length: 400 }, (_, i) => "ck" + i + "x" + (i * 7919));
for (const id of ids.slice(0, 20)) assert.equal(cellFor(cells, id).id, cellFor(cells, id).id, "the same prisoner is always in the same cell");
const used = new Set(ids.map((id) => cellFor(cells, id).id)); assert.equal(used.size, 4, "prisoners are spread over all four cells");
assert.equal(cellFor([], "x"), null); assert.equal(hashOf("a"), hashOf("a")); assert.notEqual(hashOf("a"), hashOf("b"));

// ---- who may stand where (the server's rule for position reports)
const me = "char-1", mine = cellFor(cells, me), theirs = cells.find((c) => c.id !== mine.id), corridor = inside.compiled.rooms.find((r) => r.id === "gcorr");
const P = (o) => custodyPlacement(cells, { characterId: me, ...o });
assert.equal(P({ jailed: true, x: mine.cx, z: mine.cz }), null, "a prisoner may stand in their own cell");
assert.match(P({ jailed: true, x: theirs.cx, z: theirs.cz }), /cell/, "not in another cell");
assert.match(P({ jailed: true, x: (corridor.x0 + corridor.x1) / 2, z: (corridor.z0 + corridor.z1) / 2 }), /cell/, "not in the corridor, through the bars");
assert.match(P({ jailed: true, x: inside.compiled.spawn.x, z: inside.compiled.spawn.z }), /cell/, "not at the door either (no teleport out)");
assert.match(P({ jailed: true, x: mine.cx, z: mine.z1 + 0.5 }), /cell/, "half a metre past the bars is out");
assert.match(P({ jailed: true, x: mine.x0 - 0.5, z: mine.cz }), /cell/, "so is a step through the cell wall");
assert.match(P({ jailed: false, x: mine.cx, z: mine.cz }), /locked/, "a free person cannot enter any cell");
assert.match(P({ jailed: false, x: theirs.cx, z: theirs.cz }), /locked/);
assert.equal(P({ jailed: false, x: (corridor.x0 + corridor.x1) / 2, z: (corridor.z0 + corridor.z1) / 2 }), null, "the corridor is open to visitors");
assert.equal(P({ jailed: false, x: inside.compiled.spawn.x, z: inside.compiled.spawn.z }), null, "and so is the charge desk");
assert.equal(custodyPlacement([], { jailed: true, characterId: me, x: 1, z: 1 }), null, "a building without cells has no rule");
// the same character is judged by the same cell however many times they are asked (no reassignment trick)
for (let i = 0; i < 20; i++) assert.equal(P({ jailed: true, x: mine.cx, z: mine.cz }), null);

// ---- the scene's clamp keeps anyone inside, from any start, and leaves a point inside untouched
for (const [x, z] of [[-50, -50], [999, 999], [mine.cx, mine.z1 + 3], [mine.x0 - 2, mine.cz], [mine.cx, mine.cz]]) { const q = clampToCell(mine, x, z); assert.ok(inCell(mine, q.x, q.z, CELL_MARGIN - 1e-9), "clamped inside: " + [x, z]); assert.ok(custodyPlacement(cells, { jailed: true, characterId: me, x: q.x, z: q.z }) === null, "and the server accepts it"); }
assert.deepEqual(clampToCell(mine, mine.cx, mine.cz), { x: mine.cx, z: mine.cz }); assert.deepEqual(cellSpot(mine), { x: mine.cx, z: mine.cz, floor: 0 });
assert.equal(cellAt(cells, theirs.cx, theirs.cz)?.id, theirs.id); assert.equal(cellAt(cells, corridor.x0 + 1, corridor.z0 + 1), null);

// ---- other players see detainees in their cells, and only real detainees are flagged
const NOW = Date.UTC(2026, 9, 20, 12, 0), future = new Date(NOW + 3_600_000), past = new Date(NOW - 1000);
const row = (id, name, o = {}) => ({ id, name, gender: "M", level: 100, look: null, faculty: { name: "Law" }, jailedUntil: null, inPlace: null, inX: null, inZ: null, inFloor: 0, inAt: null, ...o });
const fresh = new Date(NOW - 2000);
const rows = [
  row("pris-aaaaaa1", "Detainee Fresh", { jailedUntil: future, inPlace: CUSTODY_PLACE, inX: 9999, inZ: -9999, inAt: fresh }), // a bogus stored spot
  row("pris-aaaaaa2", "Detainee Quiet", { jailedUntil: future }),                                                            // never reported
  row("free-aaaaaa3", "Visitor", { inPlace: CUSTODY_PLACE, inX: 12, inZ: 6.4, inAt: fresh }),                                  // in the corridor
  row("free-aaaaaa4", "Released", { jailedUntil: past, inPlace: CUSTODY_PLACE, inX: 1.8, inZ: 2.5, inAt: fresh }),               // sentence over, stale spot inside a cell
  row("free-aaaaaa5", "Sneaky", { inPlace: CUSTODY_PLACE, inX: 1.8, inZ: 2.5, inAt: fresh }),                                   // never jailed, a spot inside a cell
];
const seen = shapePeople({ rows, selfId: "nobody", placeId: CUSTODY_PLACE, now: NOW, cells });
const by = Object.fromEntries(seen.map((p) => [p.name, p]));
assert.equal(by["Detainee Fresh"].detained, true); assert.equal(by["Detainee Quiet"].detained, true);
for (const n of ["Visitor", "Released", "Sneaky"]) assert.equal(by[n].detained, undefined, n + " is never shown as detained");
for (const n of ["Detainee Fresh", "Detainee Quiet"]) { const p = by[n], c = cellFor(cells, rows.find((r) => r.name === n).id); assert.ok(inCell(c, p.x, p.z), n + " is drawn inside their own cell"); }
assert.equal(by["Visitor"].x, 12, "a visitor keeps their spot"); assert.equal(by["Released"].x, undefined, "a released player's stale spot in a cell is not drawn"); assert.equal(by["Sneaky"].x, undefined, "and nobody who is free is ever drawn inside a cell");
assert.equal(shapePeople({ rows: [rows[0]], blocks: [{ blockerId: "me", blockedId: "pris-aaaaaa1" }], selfId: "me", placeId: CUSTODY_PLACE, now: NOW, cells }).length, 0, "a blocked player is still hidden");
assert.equal(shapePeople({ rows: [rows[0]], selfId: "pris-aaaaaa1", placeId: CUSTODY_PLACE, now: NOW, cells }).length, 0, "you are never in your own list");
const elsewhere = shapePeople({ rows: [rows[0]], selfId: "x", placeId: "library", now: NOW }); assert.equal(elsewhere[0].detained, undefined, "outside the custody building nobody is flagged");
assert.ok(isJailed({ jailedUntil: future }, NOW) && !isJailed({ jailedUntil: past }, NOW));

// ---- the animations: police, escort and detainee clips exist, are baked by the same code as every other clip, and the activities use real ones
const need = ["guard", "patrolWalk", "patrolRun", "cuff", "escortWalk", "radio", "cuffedStand", "cuffedWalk", "detainedHold", "detainedSit", "detainedPace"];
assert.deepEqual(Object.keys(POLICE_CLIPS).sort(), need.sort()); assert.deepEqual([...POLICE_SEATED], ["detainedSit"]);
assert.ok(Object.values(POLICE_CLIPS).every((f) => typeof f === "function"));
// the scene and the remote players only ask for clips that exist
const scene = fs.readFileSync(new URL("../lib3d/interiors/scene.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../lib3d/interiors/remotePlayers.js", import.meta.url), "utf8");
for (const n of ["patrolWalk", "escortWalk", "guard", "radio", "cuffedWalk", "cuffedStand", "detainedPace", "detainedHold"]) assert.ok(scene.includes(`"${n}"`) && need.includes(n), n + " is used and defined");
for (const a of ["cell_bunk", "cell_pushups"]) { assert.ok(ACTIVITIES[a].inmate && ACTIVITIES[a].jailOk, a + " is a prisoners' activity"); assert.ok(ACTIVITIES[a].anim.length); }

// ---- the arrest cutscene is upright: nobody is carried or laid down any more, and the officers wear the police kit
const cut = fs.readFileSync(new URL("../lib3d/lectureScene.js", import.meta.url), "utf8");
assert.ok(!/carry you to the van/i.test(cut), "no carrying to the van"); assert.ok(!/frameU|lieYaw/.test(cut), "no stretcher frame"); assert.ok(/police: true/.test(cut), "toon officers are in police uniform");
assert.ok(!/vest: true, cap/.test(cut), "no hi-vis on the officers");
const gear = fs.readFileSync(new URL("../lib3d/avatar/policeGear.js", import.meta.url), "utf8"), npc = fs.readFileSync(new URL("../lib3d/avatar/npc.js", import.meta.url), "utf8");
assert.ok(/dressPolice\(av\)/.test(npc) && !/#c8e61a/.test(npc), "officer avatars get the patrol kit and not the hi-vis colour"); assert.ok(/ReflectiveStripe/.test(gear));

console.log("custody: all checks passed");
