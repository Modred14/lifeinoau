// src/app/api/invest/live/route.js
// The live prices over plain HTTP: what the Invest app polls when the realtime WebSocket is not connected (and how it first draws its charts).
// Prices are public, the same for every player, and come from the server's own market engine; nothing in the request can change them.
// Cheap by design: one snapshot a second is shared by every request in this process, and no database read happens once the market is warm.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { getMarket, snapshot, charts } from "@/lib/marketLive";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const noStore = { headers: { "Cache-Control": "no-store" } };
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401, ...noStore });
  if (!(await allowed(db, "mkt:" + uid, 90, 60_000))) return tooMany();
  try {
    const m = await getMarket(db), range = new URL(req.url).searchParams.get("range");
    return Response.json({ serverNow: Date.now(), ...snapshot(m), ...(range ? charts(m, range) : {}) }, noStore);
  } catch (e) {
    console.error("[market] live", e);
    return Response.json({ error: "Prices are unavailable for a moment. Try again." }, { status: 503, ...noStore });
  }
}
