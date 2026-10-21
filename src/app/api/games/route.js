// src/app/api/games/route.js
// The Games app: lobby, matches, moves and wagers. Everything is decided by lib/games/matchService.js; this file only checks the login and the rate limit and picks the call.
//   GET  ?match=<id>[&since=<version>]  one match (the board as YOU may see it)      GET ?history=1  your results      GET (nothing)  the lobby
//   POST { op: "challenge" | "respond" | "withdraw" | "queue" | "unqueue" | "move" | "resign" | "draw" | "rematch" | "rematchReply", ... }
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import * as games from "@/lib/games/matchService";
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
  const u = new URL(req.url).searchParams;
  if (!(await allowed(db, "games:read:" + uid, 240, 60_000))) return tooMany(); // a screen reads a live match every second or two
  try {
    if (u.get("match")) return Response.json(await games.getMatch(db, uid, u.get("match"), { since: Math.max(0, Number(u.get("since")) || 0) }));
    if (u.get("history")) return Response.json(await games.getHistory(db, uid));
    return Response.json(await games.getLobby(db, uid));
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "games:act:" + uid, 120, 60_000))) return tooMany();
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.op) {
      case "challenge": return Response.json(await games.challenge(db, uid, b));
      case "respond": return Response.json(await games.respond(db, uid, b));
      case "withdraw": return Response.json(await games.withdraw(db, uid, b));
      case "queue": return Response.json(await games.joinQueue(db, uid, b));
      case "unqueue": return Response.json(await games.leaveQueue(db, uid));
      case "move": return Response.json(await games.move(db, uid, b));
      case "resign": return Response.json(await games.resign(db, uid, b));
      case "draw": return Response.json(await games.drawOffer(db, uid, b));
      case "rematch": return Response.json(await games.rematchAsk(db, uid, b));
      case "rematchReply": return Response.json(await games.rematchReply(db, uid, b));
      default: return Response.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}