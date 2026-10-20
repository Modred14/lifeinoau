// src/app/api/relationship/route.js
import { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { pingRealtime } from "@/lib/realtimeNotify";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getRelationship, relate } from "@/lib/relationshipService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "rel:" + uid, 40, 60_000))) return tooMany();
  try {
    return Response.json(await getRelationship(db, uid));
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
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "rel:" + uid, 40, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    const { notify, ...out } = await relate(db, uid, b);
    if (notify) after(() => pingRealtime(notify)); // a note sent from Love shows up in their chat at once
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