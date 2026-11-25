// src/app/api/lecture/route.js
// Confronting a lecturer in their lecture room (lib/lectureService.js). The fight itself is POST /api/fight (lib/fightService.js).
// GET  ?at=<map place id>   where the lecturers are (the ones standing in that building, when `at` is given), whether this player may confront each of them
//                           now and why not, and the N-QRS response running for this player, if any.
// POST { action: "approach", code, requestId }   walk up to a lecturer: opens the encounter the fight must refer to. `code` is one of the player's course
//                           codes or a lecturer's seat code from the GET answer. The server checks where the player is, the clock, energy and every rule.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getLectureState, startEncounter } from "@/lib/lectureService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "lecst:" + uid, 40, 60_000))) return tooMany();
  try {
    const at = new URL(req.url).searchParams.get("at");
    return Response.json(await getLectureState(db, uid, { at: at ? String(at).slice(0, 80) : undefined }));
  } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "lecgo:" + uid, 12, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action !== "approach") return Response.json({ error: "Unknown request." }, { status: 400 });
    return Response.json(await startEncounter(db, uid, { code: typeof b.code === "string" ? b.code.slice(0, 120) : "", requestId: b.requestId }));
  } catch (e) { return fail(e); }
}
