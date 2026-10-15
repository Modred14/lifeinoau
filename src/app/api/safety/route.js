// src/app/api/safety/route.js
// app/api/safety/route.js
import { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { getUserId } from "@/lib/auth";
import { pingRealtime } from "@/lib/realtimeNotify";
import { allowed, tooMany } from "@/lib/ratelimit";
import { safety, GameError } from "@/lib/gameService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const json = async (req) => req.json().catch(() => ({}));
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "safety:" + uid, 10, 60000))) return tooMany();
  try {
    const u = new URL(req.url).searchParams;
    const { notify, ...out } = await safety(db, uid, await json(req));
    if (notify) after(() => pingRealtime(notify)); // tell the realtime server once the answer has gone out
    return Response.json(out);
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