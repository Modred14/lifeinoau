/**
 * End-to-end transport check against a RUNNING server (npm run dev -w server).
 *
 *   npx tsx server/scripts/smoke-transport.ts
 *
 * Checks: each player gets their school's transport config, a banned mode is
 * refused, a keke comes when called, carries the player along the road and
 * charges the configured fare, and the player ends up on walkable ground.
 */
import { Client } from "@colyseus/sdk";
import { joinAs } from "./smoke-account";
import {
  HAIL_LINE,
  Msg,
  PLACES,
  PX_PER_METER,
  ServerMsg,
  VEHICLE_KINDS,
  doorPoint,
  fareFor,
  findPath,
  isBlocked,
  onRoad,
  parseHailUpdate,
  parseTransportConfig,
  type HailUpdate,
  type Point,
  type TransportConfig,
} from "@campuslife/shared";

const OAU = "obafemi-awolowo-university-ile-ife";
const url = process.env.GAME_SERVER_URL ?? "http://localhost:2567";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
};

const client = new Client(url);
const a = await joinAs(client, url, "smoke_kemi", { school: OAU, level: "200L" });
const b = await joinAs(client, url, "smoke_tunde");

const configs = new Map<string, TransportConfig>();
const updates: HailUpdate[] = [];
const notices: string[] = [];
for (const room of [a, b]) {
  room.onMessage(ServerMsg.Transport, (payload: unknown) => {
    const config = parseTransportConfig(payload);
    if (config) configs.set(room.sessionId, config);
  });
}
a.onMessage(ServerMsg.Hail, (payload: unknown) => {
  const update = parseHailUpdate(payload);
  if (update) updates.push(update);
});
a.onMessage(ServerMsg.Notice, (text: unknown) => {
  if (typeof text === "string") notices.push(text);
});
a.send(Msg.Transport);
b.send(Msg.Transport);
await sleep(400);

const oau = configs.get(a.sessionId);
const other = configs.get(b.sessionId);
check(!!oau && oau.school === OAU && !oau.modes.includes("okada") && oau.modes.includes("keke"), `OAU config: ${oau?.modes.join(", ")}`);
check(!!other && other.modes.includes("walk"), `default config: ${other?.modes.join(", ")}`);

const me = () => a.state.players.get(a.sessionId)!;
const hailVehicles = [...a.state.vehicles].filter((v) => v.line === HAIL_LINE);
check(hailVehicles.length > 0 && hailVehicles.every((v) => !v.active), `${hailVehicles.length} hail vehicles in state, all parked`);
check(hailVehicles.some((v) => VEHICLE_KINDS[v.kind] === "okada") && hailVehicles.some((v) => VEHICLE_KINDS[v.kind] === "keke"), "pool has okada and keke");

const place = PLACES.find((p) => /^faculty of technology$/i.test(p.name));
if (!place || !oau) throw new Error("missing place or config");
const target = doorPoint(place, isBlocked);
const cashBefore = me().cash;

a.send(Msg.Hail, { x: target.x, y: target.y, mode: "okada" });
await sleep(400);
check(updates.at(-1)?.phase === "ended" && notices.some((n) => /does not allow okada/.test(n)), "okada is refused for an OAU student");
check(me().cash === cashBefore, "a refused hail costs nothing");

a.send(Msg.Hail, { x: target.x, y: target.y, mode: "keke", fare: 1 });
await sleep(300);
check(updates.at(-1)?.phase === "ended" || updates.at(-1)?.phase === "coming", "a second hail inside the cooldown is dropped or answered once");
await sleep(2200);
a.send(Msg.Hail, { x: target.x, y: target.y, mode: "keke", fare: 1 });
await sleep(500);
const coming = [...updates].reverse().find((u) => u.phase === "coming");
check(!!coming && coming.mode === "keke" && coming.fare >= oau.fares.keke.base && coming.fare <= oau.fares.keke.max, `keke is coming, fare ₦${coming?.fare} (a client fare is ignored)`);
if (!coming?.pickup) throw new Error("no pickup point");
check(me().cash >= coming.fare, `has cash for the fare (₦${me().cash})`);

const walk = async (to: Point) => {
  for (const wp of findPath({ x: me().x, y: me().y }, to)) {
    a.send(Msg.MoveTo, { x: Math.round(wp.x), y: Math.round(wp.y) });
    for (let i = 0; i < 400 && Math.hypot(me().x - wp.x, me().y - wp.y) > 12; i++) await sleep(50);
  }
};
await walk(coming.pickup);

let rode = false;
let offRoad = 0;
for (let i = 0; i < 2400; i++) {
  await sleep(50);
  if (me().ride) {
    rode = true;
    const v = a.state.vehicles[me().ride - 1];
    if (v && !onRoad(v.x, v.y, 2 * PX_PER_METER)) offRoad++;
  }
  if (updates.at(-1)?.phase === "arrived" || updates.at(-1)?.phase === "ended") break;
}
await sleep(400);
const done = updates.at(-1);
check(rode, "the player was carried");
check(offRoad === 0, `the keke stayed on the road (${offRoad} samples off it)`);
check(done?.phase === "arrived", `ride ended with "${done?.phase}"`);
check(done?.fare === coming.fare && me().cash === cashBefore - coming.fare, `charged exactly ₦${coming.fare} (cash ${cashBefore} to ${me().cash})`);
check(coming.fare === fareFor(oau, "keke", 0) || coming.fare > oau.fares.keke.base, "fare follows the config rule");
check(me().ride === 0 && !isBlocked(me().x, me().y), "dropped on walkable ground");
check(Math.hypot(me().x - target.x, me().y - target.y) < 150 * PX_PER_METER, "dropped near the destination");
await walk(target);
check(Math.hypot(me().x - target.x, me().y - target.y) < 8 * PX_PER_METER, "walked the last stretch to the door");

a.leave();
b.leave();
await sleep(200);
console.log(failed ? `\n${failed} check(s) failed` : "\nAll transport checks passed");
process.exit(failed ? 1 : 0);
