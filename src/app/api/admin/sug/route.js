// src/app/api/admin/sug/route.js
// app/api/admin/sug/route.js: election administration (see lib/sugAdmin.js). Administrators only; everyone else gets a 404.
// It can start or cancel an election, disqualify a candidate before voting, and trigger the count. It cannot change a ballot, a vote total or a result.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { requireAdmin, AdminError } from "@/lib/admin";
import { overview, startElection, cancelElection, disqualify, runNow } from "@/lib/sugAdmin";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
};
const ACTIONS = { start: startElection, cancel: cancelElection, disqualify, run: runNow };
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Not found." }, { status: 404 });
  if (!(await allowed(db, "admin:" + uid, 60, 60_000))) return tooMany();
  try { await requireAdmin(db, uid); return Response.json(await overview(db)); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Not found." }, { status: 404 });
  if (!(await allowed(db, "admin:" + uid, 60, 60_000))) return tooMany();
  try {
    await requireAdmin(db, uid);
    const b = await req.json().catch(() => ({})), run = typeof b.action === "string" && Object.hasOwn(ACTIONS, b.action) ? ACTIONS[b.action] : null;
    if (!run) return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json(await run(db, uid, b));
  } catch (e) { return fail(e); }
}