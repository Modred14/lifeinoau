// src/app/api/action/route.js
// app/api/action/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { doAction, GameError } from "@/lib/gameService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "act:" + uid, 60, 60000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    // The safe hustle is an activity at Oduduwa Hall (lib/activities.js): it has to be done there, standing at its ring, so it cannot be claimed from anywhere else.
    if (b.action === "hustle") return Response.json({ error: "Do the Event Gig inside Oduduwa Hall. Open the map, go there and walk to the gold ring." }, { status: 409 });
    return Response.json(await doAction(db, uid, b.action, b.requestId));
  } catch (e) {
    if (e instanceof GameError)
      return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}