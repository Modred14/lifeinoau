// lib/travelService.js
// Server side of travelling: paying the fare when you arrive, where each player is, who else is at a place, and the Hire app's driver.
// Money moves through the ledger like everything else (the fare goes to the TRANSPORT account), once per trip, whatever happens to the request.
import fs from "node:fs";
import path from "node:path";
import { currentWeek, serverNow } from "./clock.js";
import { isJailed, isRestricted, jailedMessage, suspendedMessage, expelledMessage, isSuspended, CUSTODY_PLACE, CUSTODY_NAME } from "./discipline.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { GameError, loadLocked, start, needReq } from "./gameService.js";
import { cached, scopeOf } from "./cache.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { shapePeople } from "./playerPresence.js";
import { busyIds, busyConfig, ROAD_FRESH_MS } from "./busyPlaces.js";
import { interiorOf } from "./activityService.js";
import { cellsOf, cellFor, cellSpot } from "./custodyCells.js";
import { isClub, clubOf, isNightTime, closedMessage } from "./clubs.js";
import { MODES, FARE_NAIRA, FARE_MEMO, fareKobo, isMode, clampPing, ownsCar, driverPlan, DRIVER_PLANS, driverNameFor, driverActive, homePlace, placeOf, isPlaceId, PRESENCE_MINUTES, PRESENCE_MAX } from "./travel.js";

// ---- which places exist ----
let known; // { places: Set, buildings: Set } or null when the map file cannot be read (then only the shape of the id is checked)
function knownPlaces() {
  if (known !== undefined) return known;
  try {
    const d = withExtras(JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", "oau-campus.json"), "utf8")));
    known = { places: new Set(d.places.map((p) => p.id)), buildings: new Set(d.buildings.map((b) => b.id)), info: new Map(d.places.map((p) => [p.id, { name: p.name, kind: p.kind, offmap: !!p.offmap }])) };
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
  const c = await db.character.findUnique({ where: { userId }, select: { id: true, name: true, hostel: true, transport: true, activeCar: true, placeId: true, placeAt: true, driverName: true, driverUntilWeek: true, jailedUntil: true, suspendedUntil: true, expelled: true, expelledUntil: true, tripX: true, tripZ: true, tripMode: true, tripAt: true, tripSeq: true } });
  if (!c) throw new GameError("Create a character first.", 404);
  return c;
};
// Players serving a sentence are held at Floor O, so they are only ever seen THERE (never "out and about"), and for as long as the sentence lasts
// whether or not their screen is open: a prisoner does not drop off the list when a browser tab closes.
const free = (now) => [{ OR: [{ jailedUntil: null }, { jailedUntil: { lte: now } }, { placeId: CUSTODY_PLACE }] }];
const heldAt = (now) => ({ jailedUntil: { gt: now } });
/** Where this player is: Floor O for as long as they are in custody, whatever else is stored. */
const whereIs = (c, now) => (isJailed(c, now) ? CUSTODY_PLACE : placeOf(c));

/** The cell a prisoner is held in: { id, name, x0, z0, x1, z1, cx, cz, floor } (the scene puts them there and keeps them in). */
const cellInfo = (c) => { const cell = cellFor(cellsOf(interiorOf(CUSTODY_PLACE)?.compiled), c.id); return cell ? { ...cell, spot: cellSpot(cell) } : null; };

/** Where the player is, what they can use to get around, and (with `at`) who else is at that place right now. */
export async function getTravel(db, userId, { at } = {}) {
  const c = await me(db, userId), week = await currentWeek(db), now = serverNow(), here = whereIs(c, now);
  const out = { serverNow: now, placeId: here, custody: isJailed(c, now) ? { place: CUSTODY_PLACE, name: CUSTODY_NAME, releaseAt: c.jailedUntil, cell: cellInfo(c) } : null, home: homePlace(c.hostel), hasCar: ownsCar(c), driver: driverActive(c, week) ? { name: c.driverName, untilWeek: c.driverUntilWeek, weeksLeft: c.driverUntilWeek - week + 1 } : null,
    fares: Object.fromEntries(MODES.map((m) => [m, fareKobo(m).toString()])), week };
  if (at != null) {
    if (!isPlaceId(at)) throw new GameError("No such place.", 404);
    out.people = await peopleAt(db, c, at);
  }
  return out;
}

/**
 * Real players seen at a place in the last few minutes, without anyone who has blocked you or whom you have blocked. Public details only.
 * Players who have reported a fresh position inside this building also carry x, z, floor (and anim while they are doing an activity), so the
 * building can draw them. Never lists you, and only ever lists characters (real players), never NPCs.
 */
async function peopleAt(db, c, placeId) {
  const now = new Date(), since = new Date(now.getTime() - PRESENCE_MINUTES * 60_000);
  const [rows, blocks] = await Promise.all([
    db.character.findMany({ where: { placeId, OR: [{ placeAt: { gte: since } }, heldAt(now)], id: { not: c.id }, AND: free(now), user: { status: { not: "DELETED" } } }, orderBy: { placeAt: "desc" }, take: PRESENCE_MAX + 20,
      select: { id: true, name: true, gender: true, level: true, look: true, jailedUntil: true, inPlace: true, inX: true, inZ: true, inFloor: true, inAt: true, faculty: { select: { name: true } } } }),
    db.block.findMany({ where: { OR: [{ blockerId: c.id }, { blockedId: c.id }] }, select: { blockerId: true, blockedId: true } }),
  ]);
  const standing = rows.filter((r) => r.inPlace === placeId && r.inAt && +now - +r.inAt <= 60_000).map((r) => r.id);
  const runs = standing.length ? await db.activityRun.findMany({ where: { characterId: { in: standing }, status: "RUNNING", endsAt: { gt: now } }, select: { characterId: true, activityId: true, status: true, endsAt: true } }) : [];
  const cells = placeId === CUSTODY_PLACE ? cellsOf(interiorOf(placeId)?.compiled) : [];
  return shapePeople({ rows, blocks, runs, selfId: c.id, placeId, now: +now, max: PRESENCE_MAX, cells });
}

/** How many players are at each place right now (you not counted), for the little numbers on the map. Shared for a few seconds between everyone who asks. */
export async function placeCounts(db, userId) {
  const c = await me(db, userId), now = new Date();
  const all = await cached(`pc:${scopeOf(db)}`, 8_000, async () => {
    const rows = await db.character.groupBy({ by: ["placeId"], where: { placeId: { not: "" }, OR: [{ placeAt: { gte: new Date(Date.now() - PRESENCE_MINUTES * 60_000) } }, heldAt(new Date())], AND: free(new Date()), user: { status: { not: "DELETED" } } }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.placeId, r._count._all]));
  });
  const counts = { ...all };
  if (c.placeId && counts[c.placeId] && ((c.placeAt && now - c.placeAt < PRESENCE_MINUTES * 60_000) || isJailed(c, now))) counts[c.placeId] -= 1;
  for (const k of Object.keys(counts)) if (counts[k] <= 0) delete counts[k];
  return { counts };
}

/**
 * Which named places are busy right now, for the "a lot of people are at ..." notice. Answers { places: [{ id, name }] }, busiest first, and NOTHING else: no head
 * counts, no players, no positions (the rules are in lib/busyPlaces.js).
 *
 * Only players who are really gathered are counted, from the same presence the map already keeps (nothing new is stored or polled): a character standing at a
 * place whose last report is under PRESENCE_MINUTES old (so a closed tab or a dropped connection stops counting within minutes), not held in custody, not
 * deleted, and not on the road (a trip reported in the last few seconds means passing by). Each character is one row, so nobody is counted twice. The
 * count is one grouped query shared between everybody for a few seconds. The place you are standing in is never named to you, and a place the map has no
 * name for (an unnamed building, a billboard, Floor O) is never named at all. If the map file cannot be read nothing can be named, so nothing is said.
 */
export async function busyPlaces(db, userId) {
  const c = await me(db, userId), now = serverNow(), k = knownPlaces();
  if (!k?.info) return { places: [] };
  const counts = await cached(`busy:${scopeOf(db)}`, 15_000, async () => {
    const t = new Date(), fresh = new Date(+t - PRESENCE_MINUTES * 60_000), onRoad = new Date(+t - ROAD_FRESH_MS);
    const rows = await db.character.groupBy({ by: ["placeId"], where: { placeId: { notIn: ["", CUSTODY_PLACE] }, placeAt: { gte: fresh },
      AND: [{ OR: [{ jailedUntil: null }, { jailedUntil: { lte: t } }] }, { OR: [{ tripAt: null }, { tripAt: { lt: onRoad } }] }], user: { status: { not: "DELETED" } } }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.placeId, r._count._all]));
  });
  if (isJailed(c, now)) return { places: [] }; // a prisoner is told nothing about the world outside
  const eligible = (id) => { const p = k.info.get(id); return !!p?.name && !p.offmap && p.kind !== "billboard" && id !== CUSTODY_PLACE; };
  const ids = busyIds(counts, { cfg: busyConfig(), exclude: [whereIs(c, now)], eligible });
  return { places: ids.map((id) => ({ id, name: k.info.get(id).name })) };
}

/** The map pings this every minute while it is open, so other players keep seeing you where you are. A player in custody is always at Floor O: the ping can only confirm that. */
export async function ping(db, userId) {
  const c = await me(db, userId), now = new Date(serverNow()), here = whereIs(c, +now);
  // A ping that was read just before an arrest must not move the prisoner back out of Floor O: only a player who is still free can be placed anywhere else.
  const where = here === CUSTODY_PLACE ? { id: c.id } : { id: c.id, OR: [{ jailedUntil: null }, { jailedUntil: { lte: now } }] };
  await db.character.updateMany({ where, data: { placeId: here, placeAt: now } });
  return { ok: true, placeId: here };
}

/**
 * You stepped out of a building: forget where you stood inside it, so other players stop seeing you in there at once (instead of after a few seconds).
 * Walking back in starts at the door again, exactly as arriving does.
 */
export async function leaveBuilding(db, userId) {
  const c = await me(db, userId);
  await db.character.updateMany({ where: { id: c.id }, data: { inPlace: "", inX: null, inZ: null, inAt: null } });
  return { ok: true };
}

/**
 * You have arrived: pay the fare and be at the new place. Called once per trip when the vehicle stops (or when a trekker reaches the door).
 * `requestId` makes a repeated request harmless. Trek is free and only moves you.
 */
export async function travel(db, userId, { to, mode, requestId }) {
  needReq(requestId);
  if (!isMode(mode)) throw new GameError("Pick how you want to travel.");
  if (!placeExists(to)) throw new GameError("That place is not on the map yet.", 404);
  if (isClub(to) && !isNightTime(serverNow())) throw new GameError(closedMessage(clubOf(to), serverNow()), 403); // the clubs only open at night: no trip, and no fare, to a shut club
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
      await tx.character.update({ where: { id: c.id }, data: { placeId: to, placeAt: new Date(), inPlace: "", inX: null, inZ: null, inAt: null } }); // arriving starts a new visit: the first position inside must be at the door
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
/**
 * While travelling, the map sends the player's spot every couple of seconds, in the background (lib/tripSync.js). mode "" (or no x) means the trip is over.
 * `seq` is the sender's own counter, rising with every report: a report is stored only if its seq is higher than the stored one (decided inside the one UPDATE, so two reports
 * that overtake each other on the way can never put an older spot over a newer one, and a report that lands after the trip's end cannot bring the player back onto the road).
 * A stale report is answered { ok, stale, seq } (the highest seq stored, so the sender can carry on above it). A spot further than the mode could have travelled since the last
 * report is not refused: it is stored as far as the mode could have got towards it, and answered { ok, corrected, pose } so the sender knows what other players see.
 * No seq at all (an older screen) works as before, without the ordering.
 */
export async function tripPing(db, userId, { x, z, h, mode, seq } = {}) {
  const c = await me(db, userId), now = serverNow();
  // Nobody in custody, suspended or expelled can be out on the road: refuse, and make sure no old road position lingers for others to see.
  if (isRestricted(c, now)) {
    await db.character.update({ where: { id: c.id }, data: { tripAt: null, tripMode: "", tripX: null, tripZ: null, tripH: null } });
    throw new GameError(isJailed(c, now) ? jailedMessage(c, now) : isSuspended(c, now) ? suspendedMessage(c, now) : expelledMessage(c, now), 403);
  }
  const s = Number.isFinite(seq) && seq > 0 && seq < 1e15 ? seq : null, guard = s == null ? {} : { OR: [{ tripSeq: null }, { tripSeq: { lt: s } }] }, mark = s == null ? {} : { tripSeq: s };
  const stale = async () => ({ ok: true, stale: true, seq: (await db.character.findUnique({ where: { id: c.id }, select: { tripSeq: true } }))?.tripSeq ?? c.tripSeq ?? null });
  if (!isMode(mode) || ![x, z, h].every(Number.isFinite) || Math.abs(x) > 6000 || Math.abs(z) > 6000) { // the trip is over
    const r = await db.character.updateMany({ where: { id: c.id, ...guard }, data: { tripAt: null, tripMode: "", ...mark } });
    return r.count === 0 && s != null ? stale() : { ok: true };
  }
  // Only someone who owns a car can be reported driving one (a hired driver needs a car too), whatever the browser says: refuse it and drop the road position.
  if (mode === "car" && !ownsCar(c)) { await db.character.updateMany({ where: { id: c.id, ...guard }, data: { tripAt: null, tripMode: "", tripX: null, tripZ: null, tripH: null, ...mark } }); throw new GameError("You do not have a car.", 409); }
  const t = Date.now(), p = clampPing(c.tripAt && c.tripX != null && c.tripZ != null ? { x: c.tripX, z: c.tripZ, mode: c.tripMode, at: +new Date(c.tripAt) } : null, { x, z }, mode, t);
  const r = await db.character.updateMany({ where: { id: c.id, ...guard }, data: { tripX: p.x, tripZ: p.z, tripH: h, tripMode: mode, tripAt: new Date(t), ...mark } });
  if (r.count === 0) return stale();
  return p.corrected ? { ok: true, corrected: true, pose: { x: p.x, z: p.z, h } } : { ok: true };
}

/** Real players on the road right now (positions in map metres), minus anyone blocked either way. A handful at most, so the road stays calm. */
export async function onTheRoad(db, userId, { max = 8 } = {}) {
  const c = await me(db, userId), since = new Date(Date.now() - ROAD_SECONDS * 1000);
  const [rows, blocks] = await Promise.all([
    db.character.findMany({ where: { tripAt: { gte: since }, id: { not: c.id }, user: { status: { not: "DELETED" } } }, orderBy: { tripAt: "desc" }, take: max + 10,
      select: { id: true, name: true, gender: true, look: true, tripX: true, tripZ: true, tripH: true, tripMode: true, activeCar: true, activeCarColor: true } }),
    db.block.findMany({ where: { OR: [{ blockerId: c.id }, { blockedId: c.id }] }, select: { blockerId: true, blockedId: true } }),
  ]);
  const hidden = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
  return { travellers: rows.filter((r) => !hidden.has(r.id) && r.tripX != null).slice(0, max).map((r) => ({ id: r.id.slice(-8), name: r.name, gender: r.gender, look: r.look ?? null, x: r.tripX, z: r.tripZ, h: r.tripH, mode: r.tripMode, ...(r.tripMode === "car" ? { car: r.activeCar || "", carColor: r.activeCarColor || "" } : {}) })) };
}