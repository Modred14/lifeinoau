// src/app/api/voice/speak/route.js
// POST { callId, text }: the optional server-side voice (VOICE_TTS_*). Streams the provider's audio back. Only for the sentences of a call that is yours.
// When no server voice is configured this answers 503 and the phone uses the browser's own voice instead.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { loadParentCall } from "@/lib/voice/parentCall";
import { audioType, speak, voiceConfig, VoiceError } from "@/lib/voice/provider";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  const cfg = voiceConfig();
  if (!cfg.tts) return Response.json({ error: "Server voice is not set up.", code: "unavailable" }, { status: 503 });
  const body = await req.json().catch(() => ({})), text = typeof body?.text === "string" ? body.text.trim().slice(0, 400) : "";
  if (!text) return Response.json({ error: "Nothing to say." }, { status: 400 });
  if (!(await allowed(db, "voice:speak:" + uid, 120, 60_000))) return tooMany();
  try {
    const { parent } = await loadParentCall(db, uid, body?.callId);
    const res = await speak(text, parent, { cfg, signal: req.signal });
    return new Response(res.body, { headers: { "content-type": audioType(cfg.ttsFormat), "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof VoiceError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[voice]", e);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
