// app/api/character/hostel/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { allowedHostels } from "@/lib/rules";
export const dynamic = "force-dynamic"; // never cache API responses
const db = globalThis.db ??= new PrismaClient();
// Step 2 of 2: choose a hostel after the reveal. Allowed only once, validated against the saved class.
export async function POST(req) {
  const userId = await getUserId(); if (!userId) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, "host:" + userId, 20, 3600000))) return tooMany();
  const { hostel } = await req.json().catch(() => ({}));
  const c = await db.character.findUnique({ where: { userId } });
  if (!c) return Response.json({ error: "Create a character first." }, { status: 404 });
  if (c.hostel) return Response.json({ error: "You already chose where to live." }, { status: 409 });
  if (!allowedHostels(c.class, c.gender, c.level).includes(hostel))
    return Response.json({ error: "That hostel is not available to you.", hostels: allowedHostels(c.class, c.gender, c.level) }, { status: 400 });
  const r = await db.character.updateMany({ where: { id: c.id, hostel: "" }, data: { hostel } }); // guards a double-click race
  return r.count ? Response.json({ ok: true }) : Response.json({ error: "You already chose where to live." }, { status: 409 });
}
