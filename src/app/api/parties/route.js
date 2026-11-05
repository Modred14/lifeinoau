// app/api/parties/route.js
// The Parties app's list: real events added by administrators, soonest first. Tickets are bought on the event's own link, so there is nothing to POST.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { listEvents } from "@/lib/partyEvents";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "party:" + uid, 30, 60_000))) return tooMany();
  try {
    return Response.json(await listEvents(db));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
