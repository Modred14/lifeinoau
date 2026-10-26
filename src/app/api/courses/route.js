// app/api/courses/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getCourses } from "@/lib/courseService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "courses:" + uid, 60, 60_000))) return tooMany();
  try {
    return Response.json(await getCourses(db, uid));
  } catch (e) {
    if (e instanceof GameError)
      return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
export async function POST() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "courses:" + uid, 60, 60_000))) return tooMany();
  // Lectures and study sessions are done INSIDE a faculty building, a lecture theatre or another study spot, at its gold ring (lib/activityService.js),
  // where the server checks where the player stands. A request made from here would skip that check, so it is refused, like /api/exam.
  return Response.json({ error: "Go to your faculty building, a lecture theatre or a study spot and use the ring there to attend a lecture or study." }, { status: 409 });
}
