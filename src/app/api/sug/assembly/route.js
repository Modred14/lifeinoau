// src/app/api/sug/assembly/route.js
// app/api/sug/assembly/route.js: the Student Representative Assembly (see lib/assemblyService.js).
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import * as A from "@/lib/assemblyService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof A.GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};
const ACTIONS = {
  "session.schedule": A.scheduleSession, "session.cancel": A.cancelSession, "session.open": A.openSession, "session.close": A.closeSession, "session.handover": A.handOver,
  attend: A.attend, "attendance.mark": A.clerkAttendance, "item.submit": A.submitItem, "item.withdraw": A.withdrawItem, "item.register": A.registerItem, "item.list": A.listItem,
  "debate.open": A.openDebate, recognise: A.recognise, speak: A.speak, "vote.open": A.openVoting, vote: A.legVote, "vote.close": A.closeVoting, minutes: A.publishMinutes,
};
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "sug:" + uid, 120, 60_000))) return tooMany(); // the open sitting is polled
  try { return Response.json(await A.getAssembly(db, uid)); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "sug:" + uid, 60, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({})), run = typeof b.action === "string" && Object.hasOwn(ACTIONS, b.action) ? ACTIONS[b.action] : null;
    if (!run) return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json(await run(db, uid, b));
  } catch (e) { return fail(e); }
}