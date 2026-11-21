// src/app/api/population/route.js
// The campus population in the header (docs/CAMPUS-POPULATION.md).
//   GET   the number now: { people, at }. The browser is told only the total, never how it is made up.
//   POST  "I have entered the game." The browser sends nothing the server believes: the server decides whether it is a genuine entry (once per cool-down per
//         player), draws the random arrival itself, adds it atomically, and tells everybody who is online (through the realtime server) when the number changed.
// Both need a signed-in player (getUserId also refuses suspended and closed accounts).
import { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { pingRealtime } from "@/lib/realtimeNotify";
import { getPopulation, recordEntry } from "@/lib/campusPopulationService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => { console.error(e); return Response.json({ error: "Something went wrong. Try again." }, { status: 500 }); };

export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "pop:" + uid, 60, 60_000))) return tooMany();
  try {
    const { people, at } = await getPopulation(db);
    return Response.json({ people, at });
  } catch (e) { return fail(e); }
}

export async function POST() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "popw:" + uid, 10, 60_000))) return tooMany(); // far above any honest use: an entry is reported once per visit
  try {
    const r = await recordEntry(db, uid);
    if (r.counted) after(() => pingRealtime({ type: "population", people: r.people, at: r.at })); // everybody online sees the new number at once
    return Response.json({ ok: true, people: r.people, at: r.at });
  } catch (e) { return fail(e); }
}
