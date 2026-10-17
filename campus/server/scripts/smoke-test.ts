/**
 * End-to-end smoke test against a RUNNING server (npm run dev -w server).
 *
 *   npm run smoke -w server
 *
 * Checks: two clients see each other, movement works, buildings block,
 * joining needs an account, position "cheats" are ignored, vehicles drive, and
 * a student can enter the SUB, buy food, eat it and walk out.
 */
import { Client, Callbacks } from "@colyseus/sdk";
import { departmentCount, sanitizeDepartment } from "@campuslife/shared/departments";
import { sanitizeLevel } from "@campuslife/shared/levels";
import { SCHOOL_COUNT, findSchool, searchSchools } from "@campuslife/shared/schools";
import { authPost, joinAs, joinWith, smokeAccount } from "./smoke-account";
import { BUILDINGS, CAMPUS_ROOM, CampusState, INTERIORS, INTERIOR_X0, LeaveCode, Msg, PLACES, PX_PER_METER, SPOTS, findPath, pointInPoly, segmentClear } from "@campuslife/shared";

const url = process.env.GAME_SERVER_URL ?? "http://localhost:2567";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
};

check(SCHOOL_COUNT > 700, `school list loaded (${SCHOOL_COUNT})`);
check(searchSchools("oau")[0]?.id === "obafemi-awolowo-university-ile-ife", "school search finds OAU by short name");
check(searchSchools("unilag")[0]?.name === "University of Lagos", "school search finds UNILAG by website name");
check(searchSchools("x").length === 0 && searchSchools(undefined).length === 0, "school search ignores short or invalid queries");
check(findSchool("other")?.type === "other" && findSchool("<script>") === undefined, "unknown school ids are rejected");
check(sanitizeLevel("polytechnic", "HND1") === "HND1" && sanitizeLevel("polytechnic", "300L") === "", "levels are checked against the school type");
check(departmentCount("university") > 200 && departmentCount("polytechnic") > 80 && departmentCount("college") > 40, "department lists loaded for every school type");
check(sanitizeDepartment("university", "computer-science") === "computer-science" && sanitizeDepartment("college", "petroleum-engineering") === "", "departments are checked against the school type");
check(sanitizeDepartment("polytechnic", "other") === "other" && sanitizeDepartment("university", 42) === "", "unknown departments are rejected, the not-listed option is kept");

const client = new Client(url);
const refused = async (options: object) =>
  client.joinOrCreate(CAMPUS_ROOM, options, CampusState).then(
    (room) => room.leave(true).then(() => false),
    () => true,
  );
check(await refused({}), "joining without an account is refused");
check(await refused({ ticket: "not-a-real-ticket" }), "a made-up ticket is refused");
const ada = await smokeAccount(url, "@Smoke_Ada");
const usedTicket = (await authPost(url, "ticket", {}, ada.token)).data.ticket;
const a = await client.joinOrCreate(CAMPUS_ROOM, { ticket: usedTicket, fresh: true }, CampusState);
check(await refused({ ticket: usedTicket }), "a ticket only works once");
const b = await joinAs(client, url, "smoke_bola");
await sleep(300);

check(a.roomId === b.roomId, "both clients landed in the same room");
check(b.state.players.size >= 2, "client B sees both players");
const meA = () => b.state.players.get(a.sessionId)!;
check(meA().name === "@smoke_ada", `players are shown by their handle -> "${meA().name}"`);

// Remote-move tracking via callbacks (what the game client uses).
let changes = 0;
Callbacks.get(b).onChange(meA(), () => changes++);

// 1) Walk for 500 ms with a held direction (one that's clear of stalls/walls).
const start = { x: meA().x, y: meA().y };
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const [ux, uy] = dirs.find(([x, y]) => segmentClear(start.x, start.y, start.x + x * 120, start.y + y * 120)) ?? [1, 0];
a.send(Msg.MoveDir, { dx: ux, dy: uy });
await sleep(500);
a.send(Msg.MoveDir, { dx: 0, dy: 0 });
await sleep(150);
const moved = (meA().x - start.x) * ux + (meA().y - start.y) * uy;
check(moved > 25 && moved < 110, `held direction moved at walking speed (moved ${moved}px)`);
check(changes > 3, `B received ${changes} position updates for A`);

// 2) Cheat attempts: fake position fields and out-of-map targets are ignored/clamped.
const before = { x: meA().x, y: meA().y };
a.send("pos" as any, { x: 5, y: 5 });
a.send(Msg.MoveDir, { dx: -999 * ux, dy: -999 * uy, x: 5, y: 5 } as any);
await sleep(200);
a.send(Msg.MoveDir, { dx: 0, dy: 0 });
await sleep(150);
const dx = -((meA().x - before.x) * ux + (meA().y - before.y) * uy);
check(dx > 0 && dx < 40, `oversized/forged input only moves at normal speed (moved ${dx}px)`);

// 3) Tap-to-move straight into the SUB building: must stop at its wall, never inside.
const subPlace = PLACES.find((pl) => /student union/i.test(pl.name))!;
const sub = BUILDINGS[subPlace.building!];
// Get to the door first (food stalls stand around the forecourt).
for (const wp of findPath({ x: meA().x, y: meA().y }, subPlace.door)) {
  a.send(Msg.MoveTo, wp);
  await sleep(200 + (Math.hypot(wp.x - meA().x, wp.y - meA().y) / 110) * 1000);
}
const before3 = { x: meA().x, y: meA().y };
a.send(Msg.MoveTo, subPlace.label);
await sleep(5000);
const p = meA();
const startDist = Math.hypot(before3.x - subPlace.label.x, before3.y - subPlace.label.y);
const endDist = Math.hypot(p.x - subPlace.label.x, p.y - subPlace.label.y);
check(!pointInPoly(p.x, p.y, sub.poly), `stopped outside the SUB building at (${p.x}, ${p.y})`);
check(endDist < startDist - 10, `actually walked toward it (${(startDist / 20).toFixed(1)}m -> ${(endDist / 20).toFixed(1)}m from centre)`);

// 4) Vehicles exist and drive.
check(b.state.vehicles.length >= 4, `${b.state.vehicles.length} shuttles/buses in state`);
const vpos = [...b.state.vehicles].map((v) => [v.x, v.y]);
await sleep(12000);
const movedVehicles = [...b.state.vehicles].filter((v, i) => Math.hypot(v.x - vpos[i][0], v.y - vpos[i][1]) > 40).length;
check(movedVehicles > 0, `${movedVehicles} vehicle(s) moved along their routes`);

// 5) B walks to the SUB door, enters, buys shawarma, eats it, leaves.
const subIndex = PLACES.indexOf(subPlace);
const meB = () => b.state.players.get(b.sessionId)!;
for (const wp of findPath({ x: meB().x, y: meB().y }, subPlace.door)) {
  b.send(Msg.MoveTo, wp);
  await sleep(200 + (Math.hypot(wp.x - meB().x, wp.y - meB().y) / 110) * 1000);
}
b.send(Msg.Enter, { place: subIndex });
await sleep(300);
check(meB().x >= INTERIOR_X0, `entered the SUB (x=${meB().x})`);
const inside = INTERIORS[subIndex]!;
const m = PX_PER_METER;
// Walk up the clear aisle (x = 16 m), past the dance floor and DJ booth, to the counters.
b.send(Msg.MoveTo, { x: inside.ox + 16 * m, y: inside.oy + 20 * m });
await sleep(1000);
b.send(Msg.MoveTo, { x: inside.ox + 16 * m, y: inside.oy + 4 * m });
await sleep(3500);
b.send(Msg.MoveTo, { x: inside.ox + 20 * m, y: inside.oy + 4 * m });
await sleep(1200);
const shawarma = SPOTS.findIndex((sp, i) => i >= inside.spotStart && i < inside.spotEnd && sp.label === "Shawarma");
const cash0 = meB().cash;
const price = SPOTS[shawarma].price ?? 0;
b.send(Msg.Use, { spot: shawarma });
if (cash0 >= price) {
  // Simulated students may be queueing at the counter: wait our turn.
  for (let i = 0; i < 40 && meB().act !== 3; i++) await sleep(300);
  check(meB().act === 3 && meB().cash === cash0 - price, `bought shawarma (act=${meB().act}, cash ${cash0} -> ${meB().cash})`);
  const food0 = meB().food;
  await sleep(6000);
  check(meB().act === 0 && meB().food > food0, `finished eating (food ${food0} -> ${meB().food})`);
} else {
  // Backgrounds are rolled by the server, so this student may be too broke for shawarma.
  await sleep(3000);
  check(meB().act !== 3 && meB().cash === cash0, `could not afford shawarma with ₦${cash0}, so nothing was charged`);
}
b.send(Msg.Exit);
await sleep(300);
check(meB().x < INTERIOR_X0 && Math.hypot(meB().x - subPlace.door.x, meB().y - subPlace.door.y) < 14 * m, "left the SUB through its door");

// 6) Leaving removes the player for others.
await a.leave(true);
await sleep(300);
check(!b.state.players.has(a.sessionId), "consented leave removes player");
await b.leave(true);

// 7) A returning device comes back where it left off, not at the spawn point.
const resume = await smokeAccount(url, "smoke_resume");
const first = await joinWith(client, url, resume.token, { fresh: true });
await sleep(300);
const firstMe = () => first.state.players.get(first.sessionId)!;
const spawnedAt = { x: firstMe().x, y: firstMe().y };
for (const wp of findPath(spawnedAt, subPlace.door)) {
  first.send(Msg.MoveTo, wp);
  for (let i = 0; i < 80 && Math.hypot(firstMe().x - wp.x, firstMe().y - wp.y) > 12; i++) await sleep(100);
}
await sleep(800); // let them come to a stop
const leftAt = { x: firstMe().x, y: firstMe().y };
await first.leave(true);
await sleep(300);
const second = await joinWith(client, url, resume.token);
await sleep(300);
const back = second.state.players.get(second.sessionId)!;
const walked = Math.hypot(leftAt.x - spawnedAt.x, leftAt.y - spawnedAt.y);
check(walked > 2 * m && Math.hypot(back.x - leftAt.x, back.y - leftAt.y) < 2, `rejoined where they left (${leftAt.x}, ${leftAt.y}) -> (${back.x}, ${back.y}) after walking ${Math.round(walked / m)} m`);

// 8) Signing in somewhere else ends the first session, and the save carries over.
let leftWith = 0;
second.onLeave((code) => (leftWith = code));
const elsewhere = await joinWith(client, url, (await smokeAccount(url, "smoke_resume")).token);
await sleep(400);
const moved2 = elsewhere.state.players.get(elsewhere.sessionId)!;
check(leftWith === LeaveCode.SignedInElsewhere, `the first session is ended when the account joins again (code ${leftWith})`);
check(!elsewhere.state.players.has(second.sessionId) && Math.hypot(moved2.x - leftAt.x, moved2.y - leftAt.y) < 2, "the new session has the same save and the old avatar is gone");
await elsewhere.leave(true);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
