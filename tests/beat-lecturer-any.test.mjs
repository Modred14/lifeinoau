// tests/beat-lecturer-any.test.mjs: Beat Lecturer in the Activity Panel, for ANY lecturer standing in a lecture room.
// Pure rules (which lecturers the panel offers, who a code names) are run for real; the screens and the route are checked for the wiring that carries them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { lecturerCards, LECTURER_NEAR_METRES } from "../lib/buildingPanel.js";
import { lectureRoomsOf, seatCode, seatFromCode, FACULTY_BUILDINGS, THEATRES } from "../lib/lectureVenues.js";
import { lecturerForSeat, LECTURERS } from "../lib/curriculum.js";
import { resolveLecturer } from "../lib/lectureService.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const ok = (name) => console.log("OK  ", name);

// ---- which lecturers the panel offers (appears when you are close, goes when you are not) ----
{
  const L = (code, x, z, o = {}) => ({ code, name: code, roomName: "Lecture Room", x, z, floor: 0, canConfront: true, ...o });
  const lecs = [L("far", 40, 0), L("near", 3, 4), L("nearer", 1, 1), L("upstairs", 1, 1, { floor: 1 }), L("tired", 6, 0, { canConfront: false, reason: "You are too tired to fight. Rest first." })];
  const at = { x: 0, z: 0, floor: 0 };
  const cards = lecturerCards(lecs, at);
  assert.deepEqual(cards.map((c) => c.code), ["nearer", "near", "tired"], "only same-floor lecturers within range, nearest first");
  assert.ok(cards.every((c) => c.label === "Beat Lecturer"), "every card is Beat Lecturer");
  assert.equal(cards.find((c) => c.code === "tired").blocked, "You are too tired to fight. Rest first.", "a lecturer who cannot be fought now says why");
  assert.equal(cards.find((c) => c.code === "near").blocked, null);
  assert.deepEqual(lecturerCards(lecs, { x: 100, z: 100, floor: 0 }), [], "walk away: nothing is offered");
  assert.equal(lecturerCards(lecs, { x: 40, z: 1, floor: 0 }).map((c) => c.code)[0], "far", "walk toward another lecturer: they are offered");
  assert.deepEqual(lecturerCards([], at), [], "no lecturer in the building: no card (so nothing outside a building or in a room without one)");
  assert.deepEqual(lecturerCards(undefined, at), []); assert.deepEqual(lecturerCards(lecs, null), []);
  assert.equal(lecturerCards([L("edge", LECTURER_NEAR_METRES, 0)], at).length, 1, "exactly at the limit counts");
  assert.equal(lecturerCards([L("edge", LECTURER_NEAR_METRES + 0.1, 0)], at).length, 0);
  ok("the panel offers Beat Lecturer only for lecturers close by, one card each, with the server's reason when blocked");
}

// ---- any lecturer in any lecture room can be named, and nothing else can ----
{
  const buildings = [...new Set([...Object.values(FACULTY_BUILDINGS).flat(), ...THEATRES])];
  let rooms = 0, withLecturer = 0; const seen = new Set();
  for (const b of buildings) for (const r of lectureRoomsOf(b)) {
    rooms++; const code = seatCode(r);
    assert.ok(!seen.has(code), `two lecturers share the seat code ${code}`); seen.add(code);
    const back = seatFromCode(code); assert.ok(back && back.placeId === r.placeId && back.roomId === r.roomId && back.npcIndex === r.npcIndex, `${code} does not find its room again`);
    const a = lecturerForSeat(r.placeId, r.roomId, r.npcIndex), b2 = lecturerForSeat(r.placeId, r.roomId, r.npcIndex);
    assert.deepEqual(a, b2, "the same seat is always the same lecturer"); assert.ok(a.lecturer?.name && a.difficulty > 0 && LECTURERS[a.key], `${code} gets a real lecturer`); assert.notEqual(a.key, "BOROKS", "a stranger is never Boroks");
    withLecturer++;
  }
  assert.ok(rooms >= 10, `expected many lecture rooms across the campus (found ${rooms})`);
  assert.equal(withLecturer, rooms);
  for (const bad of [undefined, null, 5, "", "seat:", "seat:hslta", "seat:hslta:nope:9", "seat:nowhere:hall:0", "BOROKS", "seat:hslta:hall:0:extra", "seat::hall:0"]) assert.equal(seatFromCode(bad), null, `forged code ${JSON.stringify(bad)} must name nobody`);
  ok(`${rooms} lecture rooms in ${buildings.length} buildings: every lecturer has a unique code, a stable identity, and forged codes name nobody`);
}

// ---- resolving a code for a player: own course, a stranger, the same person twice, forged ----
{
  const c = { faculty: { name: "Science", difficulty: 1 }, level: 100 };
  const { coursesFor } = await import("../lib/curriculum.js"), { lectureVenues } = await import("../lib/lectureVenues.js");
  const courses = coursesFor("Science", 100, 1), venues = lectureVenues("Science", courses), mine = courses[0], venue = venues.get(mine.code);
  const own = resolveLecturer(c, mine.code); assert.ok(own && own.own === true && own.lecturer.name === mine.lecturer.name, "an own course code names your lecturer");
  const ownSeat = lectureRoomsOf(venue.placeId).find((r) => r.roomId === venue.roomId && r.npcIndex === venue.npcIndex);
  const viaSeat = resolveLecturer(c, seatCode(ownSeat)); assert.ok(viaSeat.own && viaSeat.code === mine.code && viaSeat.lecturer.name === mine.lecturer.name, "standing at your own lecturer's seat names the same lecturer, not a second one");
  const taken = new Set([...venues.values()].map((v) => `${v.placeId}/${v.roomId}/${v.npcIndex}`));
  const other = THEATRES.flatMap(lectureRoomsOf).find((r) => !taken.has(`${r.placeId}/${r.roomId}/${r.npcIndex}`)); assert.ok(other, "there is a lecture room that is not one of this player's");
  const stranger = resolveLecturer(c, seatCode(other));
  assert.ok(stranger && stranger.own === false && stranger.lecturer.name && stranger.venue.placeId === other.placeId && stranger.venue.roomId === other.roomId, "any other lecturer in a lecture room can be fought");
  assert.equal(resolveLecturer(c, "seat:hslta:nope:9"), null); assert.equal(resolveLecturer(c, "NOPE 999"), null);
  // a different player sees the same stranger as the same person (the room, not the player, decides)
  assert.equal(resolveLecturer({ faculty: { name: "Law", difficulty: 1.2 }, level: 300 }, seatCode(other)).lecturer.name, stranger.lecturer.name);
  ok("codes resolve to the right lecturer for any player; forged and unknown codes resolve to nobody");
}

// ---- the wiring: route, panel, room, scene, server ----
{
  const route = read("src/app/api/lecture/route.js"), panel = read("components/BuildingPanel.js"), room = read("components/BuildingInside.js"), scene = read("lib3d/interiors/scene.js"), svc = read("lib/lectureService.js"), fight = read("lib/fightService.js"), venues = read("lib/lectureVenues.js");
  assert.ok(/export async function GET/.test(route) && /export async function POST/.test(route) && /getLectureState/.test(route) && /startEncounter/.test(route), "/api/lecture exists: GET for state, POST for the approach");
  assert.ok(/getUserId/.test(route) && /allowed\(/.test(route) && /GameError/.test(route), "the route needs a login, is rate limited and turns rule errors into answers");
  assert.ok(/b\.action !== "approach"/.test(route), "only the known action is accepted");
  assert.ok(/function LecturerTile/.test(panel) && /lecturerCards\(lecturers/.test(panel) && /onBeat\(l\)/.test(panel), "the Activity Panel shows a Beat Lecturer card per nearby lecturer and hands over once you stand at them");
  assert.ok(/api\.current\.walkTo\(ring\.x, ring\.z, ring\.floor\)/.test(panel) && /api\.current\?\.cancelWalk/.test(panel), "the character WALKS to the lecturer (no teleport) and the walk can be cancelled");
  assert.ok(/lecturers=\{lecList\}/.test(room) && /onBeat=\{\(l\) => confrontRef\.current\?\.\(l\.code, l\.npcIndex\)\}/.test(room), "the room gives the panel the lecturers and starts the same confrontation as the ring does");
  assert.ok(/get lecturerRings\(\)/.test(scene) && !/otherLecturers/.test(scene), "the scene exposes the lecturer rings it drew; no special 'other' lecturers");
  assert.ok(/lectureRoomsOf\(at\)/.test(svc) && /resolveLecturer\(c, code\)/.test(svc), "the server lists every lecturer of the building and resolves the code itself");
  assert.ok(/resolveLecturer\(c, code\)/.test(fight) && /code: course\.code/.test(fight), "the fight resolves the lecturer the same way and claims the encounter stored for them");
  assert.ok(/beatable === false/.test(venues), "a plan can opt a lecturer out");
  // the rules that must NOT be bypassed are still where they were
  assert.ok(/isJailed\(c, now\)/.test(svc) && /isAtVenue\(c, venue, now\)/.test(svc) && /FIGHT_ENERGY/.test(svc) && /already fought a lecturer this week/.test(svc), "custody, being in the building, energy and the weekly limit are still checked");
  assert.ok(/custodyFields/.test(fight) && /seizureFor/.test(fight) && /sanction\(/.test(fight), "arrest, seizure and strikes are still applied");
  ok("route, panel, room, scene and server are wired, and the existing rules are untouched");
}
console.log("beat lecturer (any lecturer) tests passed");
