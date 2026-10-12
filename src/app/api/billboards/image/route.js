// app/api/billboards/image/route.js
// The picture of one shown poster: /api/billboards/image?b=3&s=4&v=<version>. Only paid, visible posters answer. The v= part changes when the picture does, so it can be cached for long.
import { PrismaClient } from "@prisma/client";
import { GameError } from "@/lib/gameService";
import { posterImage } from "@/lib/billboards";
export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient());
export async function GET(req) {
  const u = new URL(req.url).searchParams;
  try {
    const p = await posterImage(db, Number(u.get("b")), Number(u.get("s")));
    if (!p) return new Response("Not found", { status: 404 });
    return new Response(p.bytes, { headers: { "Content-Type": p.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { if (e instanceof GameError) return new Response("Not found", { status: 404 }); console.error(e); return new Response("Error", { status: 500 }); }
}