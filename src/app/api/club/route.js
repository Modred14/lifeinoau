// src/app/api/club/route.js: the nightclubs (lib/clubService.js).
// GET  ?at=<club id>&since=<last show id>   the club as it is now: open or closed, the buyout, VIPs, tables, lights and the shows to play (polled every few seconds)
// GET  ?view=history&club=&type=&from=&to=&cursor=   the signed-in player's OWN Spending History (there is no way to ask for anyone else's)
// POST { kind, itemId, amount?, to?, requestId }   buy something. The server checks the club is open, where you stand, the price and your balance; nothing sent here decides a price.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { purchase, clubState, history } from "@/lib/clubService";
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
  const q = new URL(req.url).searchParams;
  try {
    if (q.get("view") === "history") {
      if (!(await allowed(db, "clubh:" + uid, 40, 60_000))) return tooMany();
      return Response.json(await history(db, uid, { club: q.get("club") || undefined, type: q.get("type") || undefined, from: q.get("from") || undefined, to: q.get("to") || undefined, cursor: q.get("cursor") || undefined, limit: q.get("limit") || undefined }));
    }
    if (!(await allowed(db, "clubst:" + uid, 60, 60_000))) return tooMany(); // the screen asks every few seconds while you are inside
    return Response.json(await clubState(db, uid, { at: q.get("at") || undefined, since: q.get("since") || 0 }));
  } catch (e) { return fail(e); }
}
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  try {
    if (!(await allowed(db, "clubbuy:" + uid, 20, 60_000))) return tooMany();
    const b = await req.json().catch(() => ({}));
    return Response.json(await purchase(db, uid, { kind: typeof b.kind === "string" ? b.kind : "", itemId: typeof b.itemId === "string" ? b.itemId.slice(0, 40) : undefined, amount: b.amount, to: typeof b.to === "string" ? b.to.slice(0, 40) : undefined, requestId: b.requestId }));
  } catch (e) { return fail(e); }
}