// src/app/api/sug/route.js
// app/api/sug/route.js: the SUG election (see lib/sugService.js). GET reads (?view=home|candidates|results|campaign|history), POST does one action.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError, getSug, getCandidates, getResults, getHistory, getCampaign, register, withdraw, vote, startEvent, joinEvent, inviteToEvent, pledge } from "@/lib/sugService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};
/** What each POST action runs. The player is always the session's, never anything in the body. */
const ACTIONS = { register, withdraw, vote, "event.start": startEvent, "event.join": joinEvent, "event.invite": inviteToEvent, pledge };
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "sug:" + uid, 90, 60_000))) return tooMany();
  try {
    const u = new URL(req.url).searchParams, view = u.get("view") ?? "home";
    if (view === "home") return Response.json(await getSug(db, uid));
    if (view === "candidates") return Response.json(await getCandidates(db, uid, u.get("position"), { cycleId: u.get("cycle") }));
    if (view === "results") return Response.json(await getResults(db, uid, { cycleId: u.get("cycle") }));
    if (view === "campaign") return Response.json(await getCampaign(db, uid, { position: u.get("position") }));
    if (view === "history") return Response.json(await getHistory(db, uid));
    return Response.json({ error: "Not found." }, { status: 404 });
  } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "sug:" + uid, 40, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({})), run = typeof b.action === "string" && Object.hasOwn(ACTIONS, b.action) ? ACTIONS[b.action] : null;
    if (!run) return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json(await run(db, uid, b));
  } catch (e) { return fail(e); }
}