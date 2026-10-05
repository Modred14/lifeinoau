// app/api/pregnancy/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { decidePregnancy } from "@/lib/relationshipService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = globalThis.db ??= new PrismaClient();
export async function POST(req) {
  const uid = await getUserId(); if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "rel:" + uid, 40, 60_000))) return tooMany();
  try { const b = await req.json().catch(() => ({})); return Response.json(await decidePregnancy(db, uid, b)); }
  catch (e) { if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: "Something went wrong. Try again." }, { status: 500 }); }
}
