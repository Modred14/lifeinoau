// src/app/api/messages/token/route.js
// Gives the signed-in player a short-lived chat pass and the address of the realtime server.
// { url: null } means no realtime server is set up (REALTIME_URL is empty): the app then uses plain HTTP for everything.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { whoAmI, ChatError } from "@/lib/chatCore";
import { signChatPass, CHAT_PASS_SECONDS } from "@/lib/chatAuth";
export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const noStore = { headers: { "Cache-Control": "no-store" } };
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  const url = process.env.REALTIME_URL;
  if (!url || !process.env.SESSION_SECRET) return Response.json({ url: null }, noStore);
  if (!(await allowed(db, "chatpass:" + uid, 30, 60_000))) return tooMany();
  try {
    const me = await whoAmI(db, uid);
    return Response.json({ url: url.replace(/\/+$/, ""), token: await signChatPass(process.env.SESSION_SECRET, me), expiresIn: CHAT_PASS_SECONDS }, noStore);
  } catch (e) {
    if (e instanceof ChatError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}