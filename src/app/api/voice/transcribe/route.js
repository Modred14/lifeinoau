// src/app/api/voice/transcribe/route.js
// POST (raw audio body, content-type audio/*) with ?callId=...: the server-side ears (VOICE_STT_*). Used when the browser cannot recognise speech itself.
// Answers { text }. Only for the player's own answered call home; rate limited; one short utterance per request (Vercel's request body limit is 4.5 MB, we cap at 2 MB).
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { loadParentCall } from "@/lib/voice/parentCall";
import { transcribe, voiceConfig, VoiceError } from "@/lib/voice/provider";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MAX_BYTES = 2_000_000, MIN_BYTES = 800;
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "m4a" };

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  const cfg = voiceConfig();
  if (!cfg.stt) return Response.json({ error: "Server speech recognition is not set up.", code: "unavailable" }, { status: 503 });
  const type = String(req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("audio/")) return Response.json({ error: "That is not audio." }, { status: 415 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });
  if (!(await allowed(db, "voice:stt:" + uid, 90, 60_000))) return tooMany();
  try {
    await loadParentCall(db, uid, new URL(req.url).searchParams.get("callId"));
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });
    if (buf.byteLength < MIN_BYTES) return Response.json({ text: "" }); // too short to hold words
    const text = await transcribe(new Blob([buf], { type }), { cfg, signal: req.signal, filename: `speech.${EXT[type] ?? "webm"}` });
    return Response.json({ text: text.slice(0, 600) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof GameError || e instanceof VoiceError) return Response.json({ error: e.message }, { status: e.status });
    if (e?.name === "AbortError") return new Response(null, { status: 499 });
    console.error("[voice]", e);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
