// src/app/api/bank/route.js
// The Bank app. GET ?view=overview (default) | history&filter=all|in|out|savings|transfers&cursor=... ; POST { action, requestId, ... } (see lib/bankService.js).
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getBank, getHistory, bankAction } from "@/lib/bankService";
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
  if (!(await allowed(db, "bankread:" + uid, 60, 60_000))) return tooMany();
  try {
    const q = new URL(req.url).searchParams;
    if (q.get("view") === "history") return Response.json(await getHistory(db, uid, { cursor: q.get("cursor"), filter: q.get("filter") ?? "all" }));
    return Response.json(await getBank(db, uid));
  } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "bank:" + uid, 30, 60_000))) return tooMany();
  try {
    return Response.json(await bankAction(db, uid, await req.json().catch(() => ({}))));
  } catch (e) { return fail(e); }
}
