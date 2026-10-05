// app/api/messages/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { getMessages, sendMessage, GameError } from "@/lib/gameService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = globalThis.db ??= new PrismaClient();
const json = async (req) => req.json().catch(() => ({}));
export async function GET(req) {
  const uid = await getUserId(); if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msg:" + uid, 120, 60_000))) return tooMany();
  try { const u = new URL(req.url).searchParams; return Response.json(await getMessages(db, uid, u.get("with"))); }
  catch (e) { if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: "Something went wrong. Try again." }, { status: 500 }); }
}
export async function POST(req) {
  const uid = await getUserId(); if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msg:" + uid, 120, 60_000))) return tooMany();
  try { const u = new URL(req.url).searchParams; return Response.json(await sendMessage(db, uid, await json(req))); }
  catch (e) { if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: "Something went wrong. Try again." }, { status: 500 }); }
}
