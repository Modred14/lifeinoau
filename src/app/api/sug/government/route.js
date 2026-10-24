// src/app/api/sug/government/route.js
// app/api/sug/government/route.js: the government in office, announcements and the Clerk (see lib/governmentService.js).
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError, getGovernment, announce, appointClerk, revokeClerk } from "@/lib/governmentService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};
const ACTIONS = { announce, "clerk.appoint": appointClerk, "clerk.revoke": revokeClerk };
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "sug:" + uid, 90, 60_000))) return tooMany();
  try { return Response.json(await getGovernment(db, uid)); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "sug:" + uid, 40, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({})), run = typeof b.action === "string" && Object.hasOwn(ACTIONS, b.action) ? ACTIONS[b.action] : null;
    if (!run) return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json(await run(db, uid, b));
  } catch (e) { return fail(e); }
}