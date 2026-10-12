// app/api/room/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import {
  getRoom,
  buyItem,
  placeItem,
  storeItem,
  sellItem,
} from "@/lib/roomService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient());
const json = async (req) => req.json().catch(() => ({}));
const fail = (e) => {
  if (e instanceof GameError)
    return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json(
    { error: "Something went wrong. Try again." },
    { status: 500 },
  );
};

export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "room:" + uid, 120, 60_000))) return tooMany();
  try {
    return Response.json(await getRoom(db, uid));
  } catch (e) {
    return fail(e);
  }
}

// One endpoint, four actions: buy, place, store, sell.
const ACTIONS = {
  buy: buyItem,
  place: placeItem,
  store: storeItem,
  sell: sellItem,
};
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "roomw:" + uid, 90, 60_000))) return tooMany();
  try {
    const body = await json(req),
      run = ACTIONS[body.action];
    if (!run) throw new GameError("Unknown action.");
    return Response.json(await run(db, uid, body));
  } catch (e) {
    return fail(e);
  }
}
