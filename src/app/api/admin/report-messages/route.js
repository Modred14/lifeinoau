// app/api/admin/report-messages/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { requireAdmin, AdminError, reportMessages } from "@/lib/admin";
export const dynamic = "force-dynamic"; // never cache API responses
const db = globalThis.db ??= new PrismaClient();
export async function GET(req) {
  const uid = await getUserId(); if (!uid) return Response.json({ error: "Not found." }, { status: 404 });
  if (!(await allowed(db, "admin:" + uid, 60, 60_000))) return tooMany();
  try { await requireAdmin(db, uid); const u = new URL(req.url).searchParams; return Response.json(await reportMessages(db, uid, u.get("id"))); }
  catch (e) { if (e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: "Something went wrong." }, { status: 500 }); }
}
