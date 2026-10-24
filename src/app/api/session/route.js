// app/api/session/route.js
// "Who am I?" for the landing page: tells the browser whether it already has a valid login, so a returning
// player goes straight to the game. Always answers 200 (no red errors in the console for logged-out visitors).
// Also keeps the session alive: an active player's cookie is re-issued about once a day (sliding expiry).
import { PrismaClient } from "@prisma/client";
import { readSession, startSession, endSession } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { gateOf } from "@/lib/accountGate";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function GET() {
  try {
    const s = await readSession();
    if (!s) return Response.json({ authenticated: false });
    if (!(await allowed(db, "session:" + s.userId, 60, 60_000)))
      return tooMany();
    const u = await db.user.findUnique({
      where: { id: s.userId },
      select: { id: true, status: true, statusUntil: true, statusReason: true, character: { select: { name: true } } },
    });
    if (!u) {
      await endSession();
      return Response.json({ authenticated: false });
    } // cookie for a deleted account
    const gate = gateOf(u);
    if (!gate.ok) {
      await endSession(); // suspended or closed by an administrator: the browser is signed out and told why
      return Response.json({ authenticated: false, blocked: gate.code, message: gate.message });
    }
    if (s.stale) await startSession(u.id, s.remember);
    return Response.json({
      authenticated: true,
      hasCharacter: !!u.character,
      name: u.character?.name ?? null,
    });
  } catch (e) {
    console.error(e);
    return Response.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
