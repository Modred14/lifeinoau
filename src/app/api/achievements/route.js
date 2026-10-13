// app/api/achievements/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { listAchievements } from "@/lib/achievementService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "ach:" + uid, 30, 60_000))) return tooMany();
  const list = await listAchievements(db, uid);
  return list
    ? Response.json({ achievements: list })
    : Response.json({ error: "Create a character first." }, { status: 404 });
}
