// app/api/meta/route.js
import { PrismaClient } from "@prisma/client";
import { allowed, tooMany, ipOf } from "@/lib/ratelimit";
import { PERSONALITIES } from "@/lib/rules";
import { currentWeek } from "@/lib/clock";
import { marketNews } from "@/lib/market";
export const dynamic = "force-dynamic"; // never cache API responses
const db = globalThis.db ??= new PrismaClient();
export async function GET(req) {
  if (!(await allowed(db, "meta:" + ipOf(req), 60, 60_000))) return tooMany();
  const faculties = await db.faculty.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const week = await currentWeek(db).catch(() => null);
  return Response.json({ faculties, personalities: PERSONALITIES, week, headline: week ? marketNews(week).headline : null });
}