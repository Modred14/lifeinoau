// src/app/api/messages/read/route.js: "I have read this chat" (the other player's ticks turn blue). Plain-HTTP fallback for the socket.
import { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { readMessages, GameError } from "@/lib/gameService";
import { pingRealtime } from "@/lib/realtimeNotify";
export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msg:" + uid, 120, 60_000))) return tooMany();
  try {
    const { notify, ...out } = await readMessages(db, uid, await req.json().catch(() => ({})));
    if (notify) after(() => pingRealtime(notify));
    return Response.json(out);
  } catch (e) {
    if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}