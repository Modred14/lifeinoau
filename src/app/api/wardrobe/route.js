// src/app/api/wardrobe/route.js
// The Offishall Store and wardrobe. GET: what you own, what you wear, your balance.
// POST { action: "buy", itemId, requestId } | { action: "equip", ids: [...] } | { action: "starter" }. The player is always the logged-in one.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getWardrobe, buyItem, equipOutfit, wearStarter } from "@/lib/wardrobeService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};

export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "wardrobe:" + uid, 60, 60_000))) return tooMany();
  try { return Response.json(await getWardrobe(db, uid)); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "wardrobew:" + uid, 30, 60_000))) return tooMany();
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "buy") return Response.json(await buyItem(db, uid, b));
    if (b.action === "equip") return Response.json(await equipOutfit(db, uid, b));
    if (b.action === "starter") return Response.json(await wearStarter(db, uid));
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) { return fail(e); }
}
