import { PrismaClient } from "@prisma/client";
import { getUserId, endSession } from "@/lib/auth";
import { getState, GameError } from "@/lib/gameService";
import { campusRequest, sameOrigin, noStore } from "@/lib/campus-proxy";
const db = globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15000, timeout: 60000 } });
export const dynamic = "force-dynamic";
export async function POST(request, context) {
  if (!sameOrigin(request)) return Response.json({ error: "signed_out" }, { status: 403, headers: noStore });
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "signed_out" }, { status: 401, headers: noStore });
  const { action } = await context.params;
  if (action === "sign-out") { await endSession(); return Response.json({ ok: true }, { headers: noStore }); }
  if (!["bootstrap", "ticket", "session"].includes(action)) return Response.json({ error: "invalid" }, { status: 404, headers: noStore });
  try {
    const state = await getState(db, userId);
    if (action === "session") return Response.json({ username: state.character.name, hasSave: true, level: `${state.character.level}L` }, { headers: noStore });
    const upstream = await campusRequest(request, "/oau/session", { userId });
    return Response.json(await upstream.json(), { status: upstream.status, headers: noStore });
  } catch (err) {
    if (err instanceof GameError) return Response.json({ error: err.message }, { status: err.status, headers: noStore });
    console.error("[campus] connection failed", err);
    return Response.json({ error: "Campus could not connect. Try again, or return home." }, { status: 503, headers: noStore });
  }
}
