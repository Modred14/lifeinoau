// app/api/housing/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { getHousing, moveHome } from "@/lib/housingService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
};

// The Housing app: GET lists the homes and what moving into each costs today; POST { hostel, requestId } pays and moves in at once.
export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "housing:" + uid, 60, 60_000))) return tooMany();
  try { return Response.json(await getHousing(db, uid)); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "housingw:" + uid, 20, 60_000))) return tooMany();
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await moveHome(db, uid, body));
  } catch (e) { return fail(e); }
}
