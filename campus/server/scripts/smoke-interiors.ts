/**
 * Interior smoke test against a RUNNING server (npm run dev -w server).
 *
 *   npx tsx scripts/smoke-interiors.ts   (from server/)
 *
 * Checks: buying food seats the buyer at one of the counter's tables, a
 * second buyer gets a different seat, the meal lands when eating ends, and a
 * lecture seat is used from the aisle and left to the aisle.
 */
import { Client } from "@colyseus/sdk";
import { joinAs } from "./smoke-account";
import { ACTS, INTERIORS, INTERIOR_X0, Msg, PLACES, PX_PER_METER, SPOTS, USE_DISTANCE, findPath, floorHeightAt } from "@campuslife/shared";

const url = process.env.GAME_SERVER_URL ?? "http://localhost:2567";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const m = PX_PER_METER;
let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
};

const client = new Client(url);
const a = await joinAs(client, url, "smoke_diner_a");
const b = await joinAs(client, url, "smoke_diner_b");
await sleep(300);
const me = (room: typeof a) => room.state.players.get(room.sessionId)!;
const seenByB = () => b.state.players.get(a.sessionId)!;

async function walkTo(room: typeof a, target: { x: number; y: number }) {
  for (const wp of findPath({ x: me(room).x, y: me(room).y }, target)) {
    room.send(Msg.MoveTo, wp);
    await sleep(200 + (Math.hypot(wp.x - me(room).x, wp.y - me(room).y) / 110) * 1000);
  }
}
async function step(room: typeof a, x: number, y: number) {
  const d = Math.hypot(x - me(room).x, y - me(room).y);
  room.send(Msg.MoveTo, { x, y });
  await sleep(300 + (d / 110) * 1000);
}

const subIndex = PLACES.findIndex((p) => /student union/i.test(p.name));
const sub = INTERIORS[subIndex]!;
for (const room of [a, b]) {
  await walkTo(room, PLACES[subIndex].door);
  room.send(Msg.Enter, { place: subIndex });
  await sleep(300);
  await step(room, sub.ox + 16 * m, sub.oy + 20 * m);
  await step(room, sub.ox + 16 * m, sub.oy + 4 * m);
  await step(room, sub.ox + 6 * m, sub.oy + 4 * m);
}
check(me(a).x >= INTERIOR_X0 && me(b).x >= INTERIOR_X0, "both students are inside the SUB");

const jollof = SPOTS.findIndex((s, i) => i >= sub.spotStart && i < sub.spotEnd && s.label === "Amala & ewedu");
const price = SPOTS[jollof].price ?? 0;
const eat = ACTS.indexOf("eat");
if (me(a).cash >= price && me(b).cash >= price) {
  const cash0 = me(a).cash;
  const food0 = me(a).food;
  a.send(Msg.Use, { spot: jollof });
  for (let i = 0; i < 40 && me(a).act !== eat; i++) await sleep(300);
  const seatA = me(a).spot - 1;
  const seat = SPOTS[seatA];
  check(me(a).act === eat && me(a).cash === cash0 - price, `A bought amala (act ${me(a).act}, cash ${cash0} -> ${me(a).cash})`);
  check(seat?.menu === jollof && seat.seat !== undefined && seat.surface !== undefined, `A was seated at an amala table (spot ${seatA})`);
  check(Math.hypot(me(a).x - seat.x, me(a).y - seat.y) < 2, "A sits on the seat itself");
  check(seenByB().act === eat && seenByB().spot === seatA + 1, "B sees A eating at the same seat");
  a.send(Msg.Use, { spot: jollof });
  await sleep(300);
  check(me(a).cash === cash0 - price && me(a).spot === seatA + 1, "buying again while eating is ignored");
  b.send(Msg.Use, { spot: jollof });
  for (let i = 0; i < 40 && me(b).act !== eat; i++) await sleep(300);
  check(me(b).act === eat && me(b).spot - 1 !== seatA && SPOTS[me(b).spot - 1]?.menu === jollof, `B got a different amala seat (spot ${me(b).spot - 1})`);
  await sleep(6000);
  check(me(a).act === 0 && me(a).spot === 0 && me(a).food > food0, `A finished eating (food ${food0} -> ${me(a).food})`);
  check(Math.hypot(me(a).x - seat.sx, me(a).y - seat.sy) < 2, "A stood up beside the chair");
} else {
  console.log(`SKIP  dining checks: not enough cash (A ₦${me(a).cash}, B ₦${me(b).cash})`);
}
a.send(Msg.Exit);
b.send(Msg.Exit);
await sleep(300);

const door = PLACES[subIndex].door;
const halls = INTERIORS.filter((it) => it?.template.id === "lecture").map((it) => it!);
halls.sort((p, q) => Math.hypot(PLACES[p.place].door.x - door.x, PLACES[p.place].door.y - door.y) - Math.hypot(PLACES[q.place].door.x - door.x, PLACES[q.place].door.y - door.y));
const hall = halls[0];
await walkTo(a, PLACES[hall.place].door);
a.send(Msg.Enter, { place: hall.place });
await sleep(300);
if (me(a).x >= INTERIOR_X0) {
  check(floorHeightAt(me(a).x, me(a).y) > 1, `entered ${PLACES[hall.place].name} on the top landing`);
  const seatIndex = hall.spotStart + hall.template.spots.length - 10;
  const seat = SPOTS[seatIndex];
  await step(a, seat.sx, me(a).y);
  await step(a, seat.sx, seat.sy);
  check(Math.hypot(me(a).x - seat.sx, me(a).y - seat.sy) <= USE_DISTANCE, "walked down the aisle to the row");
  a.send(Msg.Use, { spot: seatIndex });
  await sleep(400);
  const act = ACTS[me(a).act];
  check((act === "study" || act === "exam") && me(a).spot === seatIndex + 1, `sat in a lecture seat (${act})`);
  check(Math.hypot(me(a).x - seat.x, me(a).y - seat.y) < 2, "the server moved the student onto the bench");
  a.send(Msg.StopAct);
  await sleep(300);
  check(me(a).act === 0 && Math.hypot(me(a).x - seat.sx, me(a).y - seat.sy) < 2, "standing up returns to the aisle");
} else {
  console.log(`SKIP  lecture checks: could not reach ${PLACES[hall.place].name}`);
}

await a.leave(true);
await b.leave(true);
console.log(failed ? `\n${failed} check(s) failed` : "\nAll interior checks passed");
process.exit(failed ? 1 : 0);
