import { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { whoAmI, deleteMessage, ChatError } from "@/lib/chatCore";
import { pingRealtime } from "@/lib/realtimeNotify";

export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msg:" + uid, 120, 60_000))) return tooMany();
  try {
    const body = await req.json().catch(() => ({}));
    const me = await whoAmI(db, uid);
    const { notify, ...result } = await deleteMessage(db, me, body.id, body.mode);
    after(() => pingRealtime(notify));
    return Response.json(result);
  } catch (error) {
    if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status });
    console.error(error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
