// app/api/faculty/route.js: what your faculty building shows, and sitting a surprise test there (lib/facultyService.js)
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getFaculty, takeTest } from "@/lib/facultyService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  try { return Response.json(await getFaculty(db, uid)); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "faculty:" + uid, 20, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "test") return Response.json(await takeTest(db, uid, b));
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) { return fail(e); }
}