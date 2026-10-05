// app/api/career/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getCareer } from "@/lib/careerService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = globalThis.db ??= new PrismaClient();
export async function GET(req) {
  const uid = await getUserId(); if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "career:" + uid, 40, 60_000))) return tooMany();
  try { return Response.json(await getCareer(db, uid)); }
  catch (e) { if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: "Something went wrong. Try again." }, { status: 500 }); }
}
