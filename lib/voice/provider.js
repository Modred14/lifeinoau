// lib/voice/provider.js  (server only: reads secrets from the environment, never imported by client code)
// Talks to the AI that speaks for Mummy / Daddy. Any provider with an OpenAI-compatible API works, so the provider can be changed (or moved to a free one)
// by changing environment variables only:
//
//   THE BRAIN (required for voice calls)
//     VOICE_LLM_API_KEY    the provider's key
//     VOICE_LLM_BASE_URL   e.g. https://api.groq.com/openai/v1   or   https://generativelanguage.googleapis.com/v1beta/openai   (no trailing slash)
//     VOICE_LLM_MODEL      a chat model the provider offers (no default: provider model names change, so you choose)
//   THE VOICE (optional: without it the browser's own text-to-speech speaks)
//     VOICE_TTS_API_KEY, VOICE_TTS_BASE_URL, VOICE_TTS_MODEL        an OpenAI-compatible /audio/speech endpoint
//     VOICE_TTS_VOICE_MUMMY, VOICE_TTS_VOICE_DADDY                  the provider's voice names (a warm adult female voice for Mummy)
//     VOICE_TTS_FORMAT     mp3 (default) | wav | opus
//
// Nothing here is ever sent to the browser except the generated sentences / audio.
import { sentenceStream } from "./persona.js";

const trim = (u) => String(u ?? "").trim().replace(/\/+$/, "");

/** What is configured, from an environment object. `llm` is false when voice calls cannot work at all (the browser then keeps the old text call). */
export function voiceConfig(env = process.env) {
  const llm = !!(env.VOICE_LLM_API_KEY && trim(env.VOICE_LLM_BASE_URL) && env.VOICE_LLM_MODEL);
  const tts = !!(env.VOICE_TTS_API_KEY && trim(env.VOICE_TTS_BASE_URL) && env.VOICE_TTS_MODEL && env.VOICE_TTS_VOICE_MUMMY);
  return {
    llm, tts,
    llmBase: trim(env.VOICE_LLM_BASE_URL), llmKey: env.VOICE_LLM_API_KEY, llmModel: env.VOICE_LLM_MODEL,
    ttsBase: trim(env.VOICE_TTS_BASE_URL), ttsKey: env.VOICE_TTS_API_KEY, ttsModel: env.VOICE_TTS_MODEL,
    ttsFormat: env.VOICE_TTS_FORMAT || "mp3",
    voices: { Mummy: env.VOICE_TTS_VOICE_MUMMY, Daddy: env.VOICE_TTS_VOICE_DADDY || env.VOICE_TTS_VOICE_MUMMY },
  };
}
/** What the browser is allowed to know. */
export const publicStatus = (cfg = voiceConfig()) => ({ available: cfg.llm, speech: cfg.llm ? (cfg.tts ? "server" : "browser") : null });

export class VoiceError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }

/** Streams the model's reply as text pieces. Throws VoiceError on a provider failure. `signal` cancels the request (the player interrupted). */
export async function* streamReply(messages, { cfg = voiceConfig(), signal, fetchImpl = fetch, maxTokens = 140 } = {}) {
  if (!cfg.llm) throw new VoiceError("Voice calls are not set up.", 503);
  let res;
  try {
    res = await fetchImpl(`${cfg.llmBase}/chat/completions`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.llmKey}` },
      body: JSON.stringify({ model: cfg.llmModel, messages, stream: true, max_tokens: maxTokens, temperature: 0.85 }),
    });
  } catch (e) { if (e?.name === "AbortError") return; throw new VoiceError("The voice service could not be reached."); }
  if (!res.ok || !res.body) {
    // The player only ever sees a friendly line; the owner needs the real reason (wrong model name, bad key, limit reached...) in the server logs. The key is never logged.
    const why = await res.text().then((t) => t.slice(0, 300)).catch(() => "");
    console.error(`[voice] AI provider answered ${res.status} for model "${cfg.llmModel}" at ${cfg.llmBase}: ${why}`);
  }
  if (!res.ok || !res.body) throw new VoiceError(res.status === 429 ? "The voice service is busy. Try again shortly." : "The voice service did not answer.", res.status === 429 ? 429 : 502);
  const dec = new TextDecoder(); let buf = "";
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try { const t = JSON.parse(data)?.choices?.[0]?.delta?.content; if (t) yield t; } catch { /* a keep-alive or partial line: skip it */ }
      }
    }
  } catch (e) { if (e?.name === "AbortError") return; throw new VoiceError("The voice service dropped the connection."); }
}

/** The reply as whole sentences (what the browser speaks one by one). */
export async function* streamSentences(messages, opts) {
  const split = sentenceStream();
  for await (const piece of streamReply(messages, opts)) for (const s of split.push(piece)) yield s;
  for (const s of split.flush()) yield s;
}

/** Text to speech through the optional provider. Returns the provider's Response (audio body) or throws. */
export async function speak(text, parent, { cfg = voiceConfig(), signal, fetchImpl = fetch } = {}) {
  if (!cfg.tts) throw new VoiceError("Server voice is not set up.", 503);
  const res = await fetchImpl(`${cfg.ttsBase}/audio/speech`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.ttsKey}` },
    body: JSON.stringify({ model: cfg.ttsModel, input: String(text).slice(0, 400), voice: cfg.voices[parent] ?? cfg.voices.Mummy, response_format: cfg.ttsFormat }),
  });
  if (!res.ok || !res.body) {
    console.error(`[voice] speech provider answered ${res.status} for model "${cfg.ttsModel}" at ${cfg.ttsBase}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new VoiceError("The voice service could not speak.", res.status === 429 ? 429 : 502);
  }
  return res;
}
export const audioType = (fmt) => ({ mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg" })[fmt] ?? "audio/mpeg";
