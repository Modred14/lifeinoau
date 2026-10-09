// app/api/meta/route.js
import { PrismaClient } from "@prisma/client";
import { allowed, tooMany, ipOf } from "@/lib/ratelimit";
import { PERSONALITIES } from "@/lib/rules";
import { currentWeek } from "@/lib/clock";
import { FACULTIES } from "@/lib/faculties";
import { marketNews } from "@/lib/market";
export const dynamic = "force-dynamic"; // never cache API responses
const db = globalThis.db ??= new PrismaClient();
export async function GET(req) {
  if (!(await allowed(db, "meta:" + ipOf(req), 60, 60_000))) return tooMany();
  // Sign-up must always offer every faculty, even if the database was seeded with an older list: add any that are missing.
  const names = FACULTIES.map(([n]) => n), have = await db.faculty.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  const missing = FACULTIES.filter(([n]) => !have.some((h) => h.name === n));
  if (missing.length) await db.faculty.createMany({ data: missing.map(([name, difficulty]) => ({ name, difficulty })), skipDuplicates: true });
  const rows = missing.length ? await db.faculty.findMany({ where: { name: { in: names } }, select: { id: true, name: true } }) : have;
  const faculties = names.map((n) => rows.find((r) => r.name === n)).filter(Boolean);
  const week = await currentWeek(db).catch(() => null);
  return Response.json({ faculties, personalities: PERSONALITIES, week, headline: week ? marketNews(week).headline : null });
}