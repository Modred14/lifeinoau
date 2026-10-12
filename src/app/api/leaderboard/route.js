// app/api/leaderboard/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { getBoard } from "@/lib/leaderboards";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient());
export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "board:" + uid, 30, 60_000))) return tooMany();
  const board = await getBoard(
    db,
    new URL(req.url).searchParams.get("board") ?? "forbes",
  );
  return board
    ? Response.json(board)
    : Response.json({ error: "Unknown leaderboard." }, { status: 404 });
}
