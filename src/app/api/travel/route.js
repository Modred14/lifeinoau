// src/app/api/travel/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getTravel, placeCounts, ping, travel, tripPing, onTheRoad, leaveBuilding } from "@/lib/travelService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};

// GET: where you are and what you can use to get around.
//   ?at=<placeId>  also lists the real players at that place right now
//   ?road=1        real players on the road right now
//   ?counts=1      how many players are at each place (the little numbers on the map)
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "travel:" + uid, 120, 60_000))) return tooMany();
  try {
    const u = new URL(req.url).searchParams;
    if (u.get("road")) return Response.json(await onTheRoad(db, uid));
    if (u.get("counts")) return Response.json(await placeCounts(db, uid));
    return Response.json(await getTravel(db, uid, { at: u.get("at") }));
  } catch (e) { return fail(e); }
}

// POST { to, mode, requestId }  you have arrived: pay the fare, be at the new place.
// POST { action: "trip", x, z, h, mode }  where you are on the road (or no mode: the trip is over).
// POST { action: "ping" }       you are still here (sent every minute while the map is open).
// POST { action: "leave" }      you stepped out of a building: other players stop seeing you inside it.
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "travelw:" + uid, 60, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "trip") return Response.json(await tripPing(db, uid, b));
    if (b.action === "ping") return Response.json(await ping(db, uid));
    if (b.action === "leave") return Response.json(await leaveBuilding(db, uid));
    return Response.json(await travel(db, uid, b));
  } catch (e) { return fail(e); }
}