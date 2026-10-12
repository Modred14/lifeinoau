// app/api/notifications/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { markAllRead } from "@/lib/notifications";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient());
export async function POST() {
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
  await markAllRead(db, c.id);
  return Response.json({ ok: true });
}
