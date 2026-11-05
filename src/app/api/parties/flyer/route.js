// app/api/parties/flyer/route.js
// The flyer picture of one event: /api/parties/flyer?id=3&v=<version>. The v= part changes when the picture does, so it can be cached for long.
import { PrismaClient } from "@prisma/client";
import { flyerImage } from "@/lib/partyEvents";
export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function GET(req) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  try {
    const f = await flyerImage(db, id);
    if (!f) return new Response("Not found", { status: 404 });
    return new Response(f.bytes, { headers: { "Content-Type": f.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { console.error(e); return new Response("Error", { status: 500 }); }
}
