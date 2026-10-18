// src/app/api/rides/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getRides, buyCar, useCar } from "@/lib/carService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};

// The Ride app: GET shows the showroom, your garage and the car you drive.
// POST { action: "buy", modelId, color, requestId } buys a car; { action: "use", modelId } chooses which owned car you drive.
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "rides:" + uid, 60, 60_000))) return tooMany();
  try { return Response.json(await getRides(db, uid)); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "ridesw:" + uid, 20, 60_000))) return tooMany();
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "buy") return Response.json(await buyCar(db, uid, body));
    if (body.action === "use") return Response.json(await useCar(db, uid, body));
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) { return fail(e); }
}