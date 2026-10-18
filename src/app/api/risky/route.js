// src/app/api/risky/route.js
// app/api/risky/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "risky:" + uid, 20, 60000))) return tooMany();
  try {
    // The risky hustle is an activity inside the Student Union Building (lib/activities.js): it can only be done there, at its ring.
    return Response.json({ error: "Do the Back-Room Deal inside the Student Union Building. Open the map, go there and walk to the gold ring." }, { status: 409 });
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