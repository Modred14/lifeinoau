// app/api/courses/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getCourses, courseAction } from "@/lib/courseService";
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
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "courses:" + uid, 60, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    return Response.json(await courseAction(db, uid, b));
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
