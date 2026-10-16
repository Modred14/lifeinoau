// lib/travelService.js
// Server side of travelling: paying the fare when you arrive, where each player is, who else is at a place, and the Hire app's driver.
// Money moves through the ledger like everything else (the fare goes to the TRANSPORT account), once per trip, whatever happens to the request.
import fs from "node:fs";
import path from "node:path";
import { currentWeek } from "./clock.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { GameError, loadLocked, start, needReq } from "./gameService.js";
import { cached, scopeOf } from "./cache.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { MODES, FARE_NAIRA, FARE_MEMO, fareKobo, isMode, ownsCar, driverPlan, DRIVER_PLANS, driverNameFor, driverActive, homePlace, placeOf, isPlaceId, PRESENCE_MINUTES, PRESENCE_MAX } from "./travel.js";

// ---- which places exist ----
let known; // { places: Set, buildings: Set } or null when the map file cannot be read (then only the shape of the id is checked)
function knownPlaces() {
  if (known !== undefined) return known;
  try {
    const d = withExtras(JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", "oau-campus.json"), "utf8")));
    known = { places: new Set(d.places.map((p) => p.id)), buildings: new Set(d.buildings.map((b) => b.id)) };
  } catch { known = null; }
  return known;
}
/** Is this a place on the map a player can go to? Places the map has no position for yet (some faculties, the town areas) are not. */
export function placeExists(id) {
  if (!isPlaceId(id)) return false;
  const k = knownPlaces(); if (!k) return true;
  return id.startsWith("bld_") ? k.buildings.has(Number(id.slice(4))) : k.places.has(id);
}

const me = async (db, userId) => {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, name: true, hostel: true, transport: true, placeId: true, placeAt: true, driverName: true, driverUntilWeek: true, jailedUntil: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return c;
};
const free = (now) => [{ OR: [{ jailedUntil: null }, { jailedUntil: { lte: now } }] }]; // players in Floor O are not out and about

/** Where the player is, what they can use to get around, and (with `at`) who else is at that place right now. */
export async function getTravel(db, userId, { at } = {}) {
  const c = await me(db, userId), week = await currentWeek(db), here = placeOf(c);
  const out = { placeId: here, home: homePlace(c.hostel), hasCar: ownsCar(c), driver: driverActive(c, week) ? { name: c.driverName, untilWeek: c.driverUntilWeek, weeksLeft: c.driverUntilWeek - week + 1 } : null,
    fares: Object.fromEntries(MODES.map((m) => [m, fareKobo(m).toString()])), week };
  if (at != null) {
    if (!isPlaceId(at)) throw new GameError("No such place.", 404);
    out.people = await peopleAt(db, c, at);
  }
  return out;
}

/** Real players seen at a place in the last few minutes, without anyone who has blocked you or whom you have blocked. Public details only. */
async function peopleAt(db, c, placeId) {
  const now = new Date(), since = new Date(now.getTime() - PRESENCE_MINUTES * 60_000);
  const [rows, blocks] = await Promise.all([
    db.character.findMany({ where: { placeId, placeAt: { gte: since }, id: { not: c.id }, AND: free(now) }, orderBy: { placeAt: "desc" }, take: PRESENCE_MAX + 20,
      select: { id: true, name: true, gender: true, level: true, look: true, faculty: { select: { name: true } } } }),
    db.block.findMany({ where: { OR: [{ blockerId: c.id }, { blockedId: c.id }] }, select: { blockerId: true, blockedId: true } }),
  ]);
  const hidden = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
  return rows.filter((r) => !hidden.has(r.id)).slice(0, PRESENCE_MAX).map((r) => ({ name: r.name, gender: r.gender, level: r.level, faculty: r.faculty.name, look: r.look ?? null }));
}

/** How many players are at each place right now (you not counted), for the little numbers on the map. Shared for a few seconds between everyone who asks. */
export async function placeCounts(db, userId) {
  const c = await me(db, userId), now = new Date();
  const all = await cached(`pc:${scopeOf(db)}`, 8_000, async () => {
    const rows = await db.character.groupBy({ by: ["placeId"], where: { placeId: { not: "" }, placeAt: { gte: new Date(Date.now() - PRESENCE_MINUTES * 60_000) }, AND: free(new Date()) }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.placeId, r._count._all]));
  });
  const counts = { ...all };
  if (c.placeId && c.placeAt && now - c.placeAt < PRESENCE_MINUTES * 60_000 && counts[c.placeId]) counts[c.placeId] -= 1;
  for (const k of Object.keys(counts)) if (counts[k] <= 0) delete counts[k];
  return { counts };
}

/** The map pings this every minute while it is open, so other players keep seeing you where you are. */
export async function ping(db, userId) {
  const c = await me(db, userId), now = new Date();
  await db.character.updateMany({ where: { id: c.id, AND: free(now) }, data: { placeId: placeOf(c), placeAt: now } });
  return { ok: true, placeId: placeOf(c) };
}

/**
 * You have arrived: pay the fare and be at the new place. Called once per trip when the vehicle stops (or when a trekker reaches the door).
 * `requestId` makes a repeated request harmless. Trek is free and only moves you.
 */
export async function travel(db, userId, { to, mode, requestId }) {
  needReq(requestId);
  if (!isMode(mode)) throw new GameError("Pick how you want to travel.");
  if (!placeExists(to)) throw new GameError("That place is not on the map yet.", 404);
  const week = await start(db, userId), fare = fareKobo(mode);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      if (mode === "car" && !ownsCar(c)) throw new GameError("You do not have a car.", 409);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "trip", gameWeek: week } }); // P2002 on replay
      if (fare > 0n) {
        const sink = await tx.account.findUnique({ where: { systemName: "TRANSPORT" } });
        await transferInTx(tx, { fromId: c.account.id, toId: sink.id, amount: fare, memo: FARE_MEMO[mode], key: `trip:${c.id}:${requestId}`, week });
      }
      await tx.character.update({ where: { id: c.id }, data: { placeId: to, placeAt: new Date() } });
      return { ok: true, placeId: to, mode, paidKobo: fare.toString() };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError(`You cannot afford the ₦${FARE_NAIRA[mode].toLocaleString("en-NG")} fare.`, 402);
    throw e;
  }
}

// ---- the Hire app ----
export async function getHire(db, userId) {
  const c = await me(db, userId), week = await currentWeek(db), on = driverActive(c, week);
  return { week, hasCar: ownsCar(c), driver: on ? { name: c.driverName, untilWeek: c.driverUntilWeek, weeksLeft: c.driverUntilWeek - week + 1 } : null,
    plans: DRIVER_PLANS.map((p) => ({ weeks: p.weeks, priceKobo: (BigInt(p.naira) * 100n).toString() })) };
}

/** Pay a driver for 1, 4 or 12 weeks. Hiring again while the driver is still on the payroll adds the weeks on to the end. */
export async function hireDriver(db, userId, { weeks, requestId }) {
  needReq(requestId);
  const plan = driverPlan(Number(weeks)); if (!plan) throw new GameError("Pick one of the plans.");
  const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      if (!ownsCar(c)) throw new GameError("You need a car before you can hire a driver.", 409);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "hire", gameWeek: week } }); // P2002 on replay
      const sink = await tx.account.findUnique({ where: { systemName: "TRANSPORT" } }), price = BigInt(plan.naira) * 100n;
      await transferInTx(tx, { fromId: c.account.id, toId: sink.id, amount: price, memo: "Driver wages", key: `driver:${c.id}:${requestId}`, week });
      const name = c.driverName || driverNameFor(c.id), until = (driverActive(c, week) ? c.driverUntilWeek : week - 1) + plan.weeks;
      await tx.character.update({ where: { id: c.id }, data: { driverName: name, driverUntilWeek: until } });
      return { ok: true, driver: { name, untilWeek: until, weeksLeft: until - week + 1 }, paidKobo: price.toString() };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that plan.", 402);
    throw e;
  }
}

// ---- players on the road ----
const ROAD_SECONDS = 8; // a position older than this and the player is gone from the road
/** While travelling, the map sends the player's spot every couple of seconds. mode "" (or no x) means the trip is over. */
export async function tripPing(db, userId, { x, z, h, mode } = {}) {
  const c = await me(db, userId);
  if (!isMode(mode) || ![x, z, h].every(Number.isFinite) || Math.abs(x) > 6000 || Math.abs(z) > 6000) { await db.character.update({ where: { id: c.id }, data: { tripAt: null, tripMode: "" } }); return { ok: true }; }
  await db.character.update({ where: { id: c.id }, data: { tripX: x, tripZ: z, tripH: h, tripMode: mode, tripAt: new Date() } });
  return { ok: true };
}

/** Real players on the road right now (positions in map metres), minus anyone blocked either way. A handful at most, so the road stays calm. */
export async function onTheRoad(db, userId, { max = 8 } = {}) {
  const c = await me(db, userId), since = new Date(Date.now() - ROAD_SECONDS * 1000);
  const [rows, blocks] = await Promise.all([
    db.character.findMany({ where: { tripAt: { gte: since }, id: { not: c.id } }, orderBy: { tripAt: "desc" }, take: max + 10,
      select: { id: true, name: true, gender: true, look: true, tripX: true, tripZ: true, tripH: true, tripMode: true } }),
    db.block.findMany({ where: { OR: [{ blockerId: c.id }, { blockedId: c.id }] }, select: { blockerId: true, blockedId: true } }),
  ]);
  const hidden = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
  return { travellers: rows.filter((r) => !hidden.has(r.id) && r.tripX != null).slice(0, max).map((r) => ({ id: r.id.slice(-8), name: r.name, gender: r.gender, look: r.look ?? null, x: r.tripX, z: r.tripZ, h: r.tripH, mode: r.tripMode })) };
}