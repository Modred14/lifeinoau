// src/app/api/bet/slips/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getSlips, placeSlip } from "@/lib/bet/slipService";
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
  if (!(await allowed(db, "betslips:" + uid, 90, 60_000))) return tooMany();
  try { return Response.json(await getSlips(db, uid)); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "betplace:" + uid, 30, 60_000))) return tooMany();
  try { return Response.json(await placeSlip(db, uid, await req.json().catch(() => ({})))); } catch (e) { return fail(e); }
}