// src/app/api/bet/aviator/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getAviator, aviatorBet, aviatorCash } from "@/lib/bet/aviatorService";
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
  if (!(await allowed(db, "avget:" + uid, 400, 60_000))) return tooMany(); // the open flight is checked about twice a second
  try { return Response.json(await getAviator(db, uid)); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "avpost:" + uid, 60, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "cashout") { const r = await aviatorCash(db, uid, b); return Response.json(r, { status: r.late ? 409 : 200 }); }
    return Response.json(await aviatorBet(db, uid, b));
  } catch (e) { return fail(e); }
}