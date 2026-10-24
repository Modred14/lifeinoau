// app/api/login/route.js
import { PrismaClient } from "@prisma/client";
import { check, startSession } from "@/lib/auth";
import { allowed, tooMany, ipOf } from "@/lib/ratelimit";
import { gateOf } from "@/lib/accountGate";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
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
  const gate = gateOf(u); // a suspended or closed account is told so, after the password was right (so the message is never a way to find accounts)
  if (!gate.ok)
    return Response.json({ error: gate.message, blocked: gate.code, until: gate.until ?? null }, { status: 403 });
  await db.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date(), lastActiveAt: new Date(), loginCount: { increment: 1 } } });
  await startSession(u.id, b.remember !== false); // "keep me logged in" is on unless the client says otherwise
  return Response.json({ ok: true });
}
