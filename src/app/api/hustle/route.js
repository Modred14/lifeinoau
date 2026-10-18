// app/api/hustle/route.js: the Oduduwa Hall event crew and the SUB backstairs runs (lib/hustleService.js)
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getSite, startRun, finishRun, abandonRun } from "@/lib/hustleService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  try { return Response.json(await getSite(db, uid, new URL(req.url).searchParams.get("kind"))); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "hustle:" + uid, 30, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "start") return Response.json(await startRun(db, uid, b));
    if (b.action === "finish") return Response.json(await finishRun(db, uid, b));
    if (b.action === "abandon") return Response.json(await abandonRun(db, uid, b));
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) { return fail(e); }
}