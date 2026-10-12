// app/api/billboards/route.js
// GET: every billboard (public; spots the caller owns are marked when logged in). POST: reserve, pay (test button), poster, cancel.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { listBillboards, reserveBillboard, confirmBillboardOrder, setPoster, cancelBillboardOrder, testPaymentsAllowed } from "@/lib/billboards";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient());
const fail = (e) => { if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status }); console.error(e); return Response.json({ error: "Something went wrong. Try again." }, { status: 500 }); };

export async function GET() {
  try { return Response.json(await listBillboards(db, await getUserId())); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId(); if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "bb:" + uid, 30, 60_000))) return tooMany();
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "reserve": return Response.json(await reserveBillboard(db, uid, { board: Number(b.board), slots: b.slots, whole: b.whole, caption: b.caption, image: b.image }));
      case "pay": // TEST PAYMENT. The real provider replaces this: its verified webhook calls confirmBillboardOrder instead.
        if (!testPaymentsAllowed()) return Response.json({ error: "Payments are not switched on yet." }, { status: 503 });
        return Response.json(await confirmBillboardOrder(db, String(b.orderId ?? ""), "test-payment", uid));
      case "poster": return Response.json(await setPoster(db, uid, { board: Number(b.board), slot: b.slot, caption: b.caption, image: b.image }));
      case "cancel": return Response.json(await cancelBillboardOrder(db, uid, String(b.orderId ?? "")));
      default: return Response.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}