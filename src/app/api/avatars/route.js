// src/app/api/avatars/route.js
// POST { names: [...] } -> { players: { [lowercase name]: { name, gender, look, key } } }
// The saved look of each named player, so every screen can draw their profile picture from their real 3D character (see components/PlayerAvatar.js).
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { getAvatarLooks } from "@/lib/avatarService";
export const dynamic = "force-dynamic"; // never cache API responses (a look can change at any time)
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "avatars:" + uid, 120, 60_000))) return tooMany();
  const b = await req.json().catch(() => ({}));
  try {
    return Response.json(await getAvatarLooks(db, b.names));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
