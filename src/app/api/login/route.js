// app/api/login/route.js
import { PrismaClient } from "@prisma/client";
import { check, startSession } from "@/lib/auth";
import { allowed, tooMany, ipOf } from "@/lib/ratelimit";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient());
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "")
    .trim()
    .toLowerCase();
  if (
    !(await allowed(db, "login-ip:" + ipOf(req), 20, 900_000)) ||
    !(await allowed(db, "login-email:" + email, 8, 900_000))
  )
    return tooMany();
  const u = await db.user.findUnique({ where: { email } });
  if (!u || !(await check(String(b.password ?? ""), u.passwordHash)))
    return Response.json(
      { error: "Email or password is wrong." },
      { status: 401 },
    );
  await startSession(u.id, b.remember !== false); // "keep me logged in" is on unless the client says otherwise
  return Response.json({ ok: true });
}
