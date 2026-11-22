// lib/facultyApi.js: the few lines every faculty-group route shares (login check, rate limit, error answers).
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { AdminError } from "@/lib/adminCore";

export const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));

/** Resolves { uid } for a signed-in player inside the limit, or { res } (the answer to send straight back). */
export async function guard(key, limit, ms = 60_000, { hideFrom404 = false } = {}) {
  const uid = await getUserId();
  if (!uid) return { res: Response.json({ error: hideFrom404 ? "Not found." : "Please log in." }, { status: hideFrom404 ? 404 : 401 }) };
  if (!(await allowed(db, `${key}:${uid}`, limit, ms))) return { res: tooMany() };
  return { uid };
}
export const body = (req) => req.json().catch(() => ({}));
export function fail(e) {
  if (e instanceof GameError || e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}
