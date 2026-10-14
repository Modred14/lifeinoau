// src/app/api/meta/route.js
import { PrismaClient } from "@prisma/client";
import { allowed, tooMany, ipOf } from "@/lib/ratelimit";
import { PERSONALITIES } from "@/lib/rules";
import { currentWeek } from "@/lib/clock";
import { FACULTIES } from "@/lib/faculties";
import { marketNews } from "@/lib/market";
import { cached } from "@/lib/cache";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));

// Same for every visitor and it hardly ever changes: built once a minute (one query for all visitors), and browsers / the CDN may keep it too.
async function build() {
  // Sign-up must always offer every faculty, even if the database was seeded with an older list: add any that are missing.
  const names = FACULTIES.map(([n]) => n),
    have = await db.faculty.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true },
    });
  const missing = FACULTIES.filter(([n]) => !have.some((h) => h.name === n));
  if (missing.length)
    await db.faculty.createMany({
      data: missing.map(([name, difficulty]) => ({ name, difficulty })),
      skipDuplicates: true,
    });
  const rows = missing.length
    ? await db.faculty.findMany({
        where: { name: { in: names } },
        select: { id: true, name: true },
      })
    : have;
  const faculties = names
    .map((n) => rows.find((r) => r.name === n))
    .filter(Boolean);
  const week = await currentWeek(db).catch(() => null);
  return {
    faculties,
    personalities: PERSONALITIES,
    week,
    headline: week ? marketNews(week).headline : null,
  };
}

export async function GET(req) {
  if (!(await allowed(db, "meta:" + ipOf(req), 60, 60_000))) return tooMany();
  return Response.json(await cached("meta", 60_000, build), {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    },
  });
}