// app/api/notifications/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { markAllRead } from "@/lib/notifications";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "note:" + uid, 30, 60_000))) return tooMany();
  const c = await db.character.findUnique({
    where: { userId: uid },
    select: { id: true },
  });
  if (!c)
    return Response.json(
      { error: "Create a character first." },
      { status: 404 },
    );
  const body = await req.json().catch(() => ({}));
  await markAllRead(db, c.id, body?.ids); // no ids: everything unread (the stack of game notes was closed); ids: just those results
  return Response.json({ ok: true });
}