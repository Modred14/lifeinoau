import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { whoAmI, ChatError } from "@/lib/chatCore";
import {
  chatPushConfiguration,
  chatPushEnabled,
  removeChatPushSubscription,
  saveChatPushSubscription,
} from "@/lib/chatPush";

export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const json = async (req) => req.json().catch(() => ({}));

export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msgpush:" + uid, 30, 60_000))) return tooMany();
  try {
    const me = await whoAmI(db, uid);
    const endpoint = new URL(req.url).searchParams.get("endpoint");
    return Response.json({ ...chatPushConfiguration(), enabled: await chatPushEnabled(db, me.id, endpoint) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status });
    console.error(error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "msgpush:" + uid, 30, 60_000))) return tooMany();
  try {
    const me = await whoAmI(db, uid), body = await json(req);
    const result = body.action === "remove"
      ? await removeChatPushSubscription(db, me.id, body.subscription)
      : await saveChatPushSubscription(db, me.id, body.subscription);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ChatError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && (error.message.startsWith("Invalid browser") || error.message.startsWith("Browser push"))) return Response.json({ error: error.message }, { status: 400 });
    console.error(error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
