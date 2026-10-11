// app/api/logout/route.js
import { endSession } from "@/lib/auth";
export const dynamic = "force-dynamic"; // never cache API responses
export async function POST() {
  await endSession();
  return Response.json({ ok: true });
}