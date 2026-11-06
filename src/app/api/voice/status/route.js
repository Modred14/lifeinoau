// src/app/api/voice/status/route.js
// GET: is the voice call set up on this server? { available, speech: "server" | "browser" | null }. No secrets, only what the phone needs to choose
// between the live voice call and the old text call. Nothing is "pretended": if the AI is not configured, available is false.
import { getUserId } from "@/lib/auth";
import { publicStatus } from "@/lib/voice/provider";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getUserId())) return Response.json({ error: "Please log in." }, { status: 401 });
  return Response.json(publicStatus());
}
