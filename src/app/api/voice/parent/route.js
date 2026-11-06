// src/app/api/voice/parent/route.js
// POST { callId, text?, event?: "open" | "silence" | "goodbye", history: [{ role, content }] }
// Answers with a stream of lines (application/x-ndjson): {"s":"one sentence"} ... then {"done":true}, or {"error":"..."} if the AI failed part way.
// The browser speaks each sentence as it arrives. The server keeps no call state: the call itself (who, outcome, gift) is read from the stored PhoneCall.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError } from "@/lib/gameService";
import { loadParentCall } from "@/lib/voice/parentCall";
import { VOICE_LIMITS, turnMessages } from "@/lib/voice/persona";
import { streamSentences, voiceConfig, VoiceError } from "@/lib/voice/provider";
export const dynamic = "force-dynamic"; // never cache
export const maxDuration = 60;
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const line = (o) => new TextEncoder().encode(JSON.stringify(o) + "\n");
const EVENTS = new Set(["open", "silence", "goodbye"]);

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  const cfg = voiceConfig();
  if (!cfg.llm) return Response.json({ error: "Voice calls are not set up on this server.", code: "unavailable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "", event = EVENTS.has(body?.event) ? body.event : null;
  if (!event && !text) return Response.json({ error: "Nothing was said." }, { status: 400 });
  if (!(await allowed(db, "voice:user:" + uid, 60, 60_000))) return tooMany();
  try {
    const { system, call } = await loadParentCall(db, uid, body?.callId);
    if (!(await allowed(db, "voice:call:" + call.id, VOICE_LIMITS.maxTurnsPerCall + 6, VOICE_LIMITS.maxCallMs + 120_000))) return Response.json({ error: "That was a long call. Call again later.", code: "limit" }, { status: 429 });
    const messages = turnMessages({ system, history: body?.history, text, event });
    const out = new ReadableStream({
      async start(c) {
        try {
          let n = 0;
          for await (const s of streamSentences(messages, { cfg, signal: req.signal })) { c.enqueue(line({ s })); if (++n >= 6) break; } // never a monologue
          c.enqueue(line({ done: true }));
        } catch (e) {
          if (!(e instanceof VoiceError)) console.error("[voice]", e);
          c.enqueue(line({ error: e instanceof VoiceError ? e.message : "The call dropped.", status: e?.status ?? 500 }));
        }
        c.close();
      },
    });
    return new Response(out, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (e) {
    if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[voice]", e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
