// src/app/api/messages/route.js
// The plain-HTTP road to the chat. With the realtime server running, the browser uses its socket instead and only falls back
// to these routes when the socket is down, so messaging keeps working either way.
import { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { getMessages, sendMessage, unreadCount, GameError } from "@/lib/gameService";
import { pingRealtime } from "@/lib/realtimeNotify";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const json = async (req) => req.json().catch(() => ({}));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msg:" + uid, 120, 60_000))) return tooMany();
  try {
    const u = new URL(req.url).searchParams;
    if (u.get("unread")) return Response.json(await unreadCount(db, uid)); // the phone badge only needs a number
    return Response.json(await getMessages(db, uid, u.get("with"), { before: u.get("before"), after: u.get("after") }));
  } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msg:" + uid, 120, 60_000))) return tooMany();
  try {
    const { notify, ...out } = await sendMessage(db, uid, await json(req));
    if (notify) after(() => pingRealtime(notify));
    return Response.json(out);
  } catch (e) { return fail(e); }
}