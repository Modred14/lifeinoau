/**
 * Resume after a refresh, against a private server (started here, on SMOKE_PORT).
 *
 *   npx tsx scripts/smoke-resume.ts   (from server/)
 *
 * Checks: a dropped tab comes back where it stood (outdoors, indoors and seated),
 * by reconnection token and by a new join, and a server restart keeps the same place.
 */
import { Client } from "@colyseus/sdk";
import { ACTS, CampusState, INTERIORS, INTERIOR_X0, PLACES, PX_PER_METER, SPAWN_POINT, SPOTS, findPath, interiorAt } from "@campuslife/shared";
import { realTotalNow, sleep, startServer, stopServer } from "./smoke-clock";
import { Actor, OAU, SAVE_SETTLE_MS, check, note, run, until } from "./smoke-kit";

const NAME = "smoke_resume_a";
const NEAR_PX = 3 * PX_PER_METER;
const WALK_M = 40;
const profile = { school: OAU, level: "100L", department: "computer-science" };
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= NEAR_PX;
const show = (p: { x: number; y: number }) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

function drop(actor: Actor) {
  actor.room.reconnection.enabled = false;
  actor.room.connection.close(4010);
}

function farPoint(): { x: number; y: number } {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const p = { x: SPAWN_POINT.x + Math.cos(a) * WALK_M * PX_PER_METER, y: SPAWN_POINT.y + Math.sin(a) * WALK_M * PX_PER_METER };
    if (findPath(SPAWN_POINT, p).length > 0) return p;
  }
  throw new Error("no walkable point near the spawn");
}

await run("resume", async () => {
  let url = await startServer(realTotalNow());
  let client = new Client(url);

  let a = await Actor.join(client, url, NAME, { ...profile, fresh: true });
  const target = farPoint();
  await a.walkTo(target);
  const outdoors = a.at;
  check(!near(outdoors, SPAWN_POINT), `walked away from the spawn to ${show(outdoors)}`);

  const token = a.room.reconnectionToken;
  drop(a);
  await sleep(600);
  const back = await client.reconnect(token, CampusState);
  await until(() => !!back.state.players.get(back.sessionId), 4000);
  const resumed = back.state.players.get(back.sessionId);
  check(!!resumed && near(resumed, outdoors), `token reconnect keeps the place ${resumed ? show(resumed) : "(none)"}`);
  back.reconnection.enabled = false;
  back.connection.close(4010);
  await sleep(600);

  a = await Actor.join(client, url, NAME, profile);
  check(near(a.at, outdoors), `new join after a drop keeps the place ${show(a.at)}`);

  const sub = PLACES.findIndex((p) => /student union/i.test(p.name));
  const inside = await a.enter(sub);
  const indoors = a.at;
  check(inside && indoors.x >= INTERIOR_X0, `entered ${PLACES[sub].name} at ${show(indoors)}`);
  drop(a);
  await sleep(600);
  a = await Actor.join(client, url, NAME, profile);
  check(interiorAt(a.at.x, a.at.y)?.place === sub && near(a.at, indoors), `new join indoors keeps the room ${show(a.at)}`);

  const it = INTERIORS[sub];
  const seat = it ? Array.from({ length: it.spotEnd - it.spotStart }, (_, k) => it.spotStart + k).find((i) => SPOTS[i].seat !== undefined && !SPOTS[i].price && SPOTS[i].menu === undefined) : undefined;
  if (seat === undefined) note("no seat in that building, skipping the seated check");
  else {
    await a.reach(seat);
    await a.use(seat, 1200);
    const act = a.me.act;
    const spot = a.me.spot;
    check(act > 0, `sat down (${ACTS[act]}, spot ${spot - 1})`);
    drop(a);
    await sleep(600);
    a = await Actor.join(client, url, NAME, profile);
    check(a.me.act === act && a.me.spot === spot, `new join keeps the activity (act ${ACTS[a.me.act] ?? a.me.act}, spot ${a.me.spot - 1})`);
  }

  const beforeRestart = a.at;
  a.room.reconnection.enabled = false;
  await sleep(SAVE_SETTLE_MS);
  await stopServer();
  url = await startServer(realTotalNow());
  client = new Client(url);
  a = await Actor.join(client, url, NAME, profile);
  check(near(a.at, beforeRestart), `a server restart keeps the place ${show(a.at)} (was ${show(beforeRestart)})`);
  await a.leave();
});
