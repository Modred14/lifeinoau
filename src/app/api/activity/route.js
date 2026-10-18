// src/app/api/activity/route.js
// app/api/activity/route.js: building activities (lib/activityService.js). GET = the rings of the building you are in and what you can do now.
// POST { op: "report" | "start" | "finish" | "cancel", ... }. The server checks where you are, the clock, the limits and the fee; nothing sent here decides a reward.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { status, report, startActivity, finishActivity, cancelActivity } from "@/lib/activityService";
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
  if (!(await allowed(db, "actst:" + uid, 40, 60_000))) return tooMany();
  try { return Response.json(await status(db, uid)); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.op === "report") { // the scene reports a position every few seconds: a generous limit of its own
      if (!(await allowed(db, "actpos:" + uid, 40, 60_000))) return tooMany();
      return Response.json(await report(db, uid, b));
    }
    if (!(await allowed(db, "act:" + uid, 40, 60_000))) return tooMany();
    if (b.op === "start") return Response.json(await startActivity(db, uid, { hubId: String(b.hubId ?? ""), requestId: b.requestId, x: b.x, z: b.z, floor: b.floor, param: typeof b.param === "string" ? b.param.slice(0, 20) : undefined }));
    if (b.op === "finish") return Response.json(await finishActivity(db, uid, { requestId: b.requestId, x: b.x, z: b.z, floor: b.floor }));
    if (b.op === "cancel") return Response.json(await cancelActivity(db, uid));
    return Response.json({ error: "Unknown request." }, { status: 400 });
  } catch (e) { return fail(e); }
}