// src/app/api/hire/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getHire, hireDriver } from "@/lib/travelService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};

// The Hire app: GET shows the driver you have (if any) and the plans; POST { weeks, requestId } pays for a driver.
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "hire:" + uid, 60, 60_000))) return tooMany();
  try { return Response.json(await getHire(db, uid)); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "hirew:" + uid, 20, 60_000))) return tooMany();
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await hireDriver(db, uid, body));
  } catch (e) { return fail(e); }
}