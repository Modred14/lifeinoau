// src/app/api/calls/route.js
// The Calls app. GET ?view=poll (default: the phone asks every few seconds) | home | history&cursor=... | search&q=...
// POST { action: parent | dial | answer | end | ask | approve | reject, ... } (see lib/callService.js). Money moves only on "approve", by the person being asked.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { pollCalls, callHome, callHistory, findPeople, callAction } from "@/lib/callService";
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
  try {
    const q = new URL(req.url).searchParams, view = q.get("view") ?? "poll";
    if (!(await allowed(db, `callsread:${view}:${uid}`, view === "poll" ? 90 : 40, 60_000))) return tooMany(); // the poll runs every 2-5 seconds while a tab is open
    if (view === "home") return Response.json(await callHome(db, uid));
    if (view === "history") return Response.json(await callHistory(db, uid, { cursor: q.get("cursor") }));
    if (view === "search") return Response.json(await findPeople(db, uid, q.get("q") ?? ""));
    return Response.json(await pollCalls(db, uid));
  } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "calls:" + uid, 40, 60_000))) return tooMany();
  try {
    return Response.json(await callAction(db, uid, await req.json().catch(() => ({}))));
  } catch (e) { return fail(e); }
}
