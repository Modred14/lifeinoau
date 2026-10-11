// app/api/signup/route.js
import { PrismaClient } from "@prisma/client";
import { hash, startSession } from "@/lib/auth";
import { allowed, tooMany, ipOf } from "@/lib/ratelimit";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient());
export async function POST(req) {
  if (!(await allowed(db, "signup:" + ipOf(req), 5, 3_600_000)))
    return tooMany();
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "")
      .trim()
      .toLowerCase(),
    pw = String(b.password ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return Response.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  if (pw.length < 8)
    return Response.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  if (b.isAdult !== true)
    return Response.json(
      { error: "You must confirm that you are 18 or older." },
      { status: 400 },
    );
  try {
    const u = await db.user.create({
      data: { email, passwordHash: await hash(pw), isAdult: true },
    });
    await startSession(u.id, true);
    return Response.json({ ok: true });
  } catch (e) {
    if (e.code === "P2002")
      return Response.json(
        { error: "That email is already registered." },
        { status: 409 },
      );
    throw e;
  }
}