# Voice calls

Calls in LifeinOAU are real spoken conversations. The player talks, the other side answers out loud, and nobody types or reads anything during the call.

There are two kinds of call, and they share the same Calls app, call screens and call rules (`lib/callService.js`, `components/CallLayer.js`):

| Call | Who speaks back | How the audio travels |
|---|---|---|
| **Call home** (Mummy / Daddy) | An AI character | Browser microphone -> streaming speech recognition -> AI reply streamed sentence by sentence -> spoken aloud as each sentence arrives |
| **Call a player** (Calls app, or the phone button in a chat) | The other player | WebRTC, straight from one phone to the other. The server passes only the small set-up messages |

A call is only started from the player's tap, the microphone is asked for in that tap, and the call screen always shows its real state.

## Setting it up (Mummy / Daddy)

Nothing is faked. **If the variables below are not set, `/api/voice/status` says `available: false` and the call home is the original one (the ringing story with her written line).** Nothing pretends to be a live call.

### 1. The AI that talks (required)

Any provider with an OpenAI-compatible chat API works, so it can be changed later by changing three variables:

| Variable | Meaning |
|---|---|
| `VOICE_LLM_API_KEY` | the provider's secret key (server only, never sent to the browser) |
| `VOICE_LLM_BASE_URL` | e.g. `https://api.groq.com/openai/v1` or `https://generativelanguage.googleapis.com/v1beta/openai` (no trailing slash) |
| `VOICE_LLM_MODEL` | a chat model from that provider's current list. There is deliberately no default, because providers rename and retire models |

Cheapest long-term route: pick a provider that has a free tier (Groq and Google Gemini both offer OpenAI-compatible endpoints). Free tiers and their limits change over time, so check the provider's pricing page before relying on one. Calls are short (a few sentences per turn), so usage is small.

Set these on the **website** (Vercel). The realtime server does not need them.

### 2. Her voice

**Default (free, no key): the player's own device voice.** The browser's built-in text-to-speech speaks each sentence. The game picks the best installed English female voice for Mummy (Nigerian English first, then British, preferring "Natural" / "Neural" voices) and a male one for Daddy. How warm it sounds depends on the device: Windows 11 with Edge, and recent iPhones and Androids, have good voices; older devices sound more robotic.

**Optional upgrade: a hosted voice.** For a more human, consistent Mummy on every device, set a text-to-speech provider that has an OpenAI-compatible `/audio/speech` endpoint:

| Variable | Meaning |
|---|---|
| `VOICE_TTS_API_KEY` | key for the voice provider |
| `VOICE_TTS_BASE_URL` | e.g. `https://api.openai.com/v1` (no trailing slash) |
| `VOICE_TTS_MODEL` | the provider's speech model |
| `VOICE_TTS_VOICE_MUMMY` | the provider's voice name for a warm adult female voice (**required to switch it on**) |
| `VOICE_TTS_VOICE_DADDY` | optional; defaults to Mummy's voice if unset |
| `VOICE_TTS_FORMAT` | `mp3` (default), `wav` or `opus` |

When these are set the server fetches each sentence as audio as soon as the AI writes it, and the browser plays them in order. If a sentence fails to fetch, that sentence is spoken with the device voice instead, so a call never goes silent.

### 3. For calls between players

Needs the existing realtime server (`REALTIME_URL`, see `realtime/README.md`). The set-up messages travel over its socket. Without it, calling a player still works as before (ringing, answering, asking for money) and the call screen says plainly that voice is not available.

Audio uses Google's free public STUN server. Some networks (strict mobile carriers, school or office wifi) block direct phone-to-phone audio and need a TURN relay as well. To add one, set `NEXT_PUBLIC_RTC_ICE_SERVERS` to a JSON list, for example `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:your-turn-host:3478","username":"...","credential":"..."}]`. Note that this variable is public (it is sent to browsers), so use a TURN account made for that, not a master key.

## How a call home works

1. The player taps **Call Mummy**. In that same tap the browser unlocks sound, then asks for the microphone. **If the microphone is refused, no call is made and nothing is used up** (no cooldown, no weekly count).
2. The server rolls the call exactly as before (`lib/callRules.js`): picked up or not, gift or not. A gift is paid in the same transaction. The AI is only *told* the result and cannot change it.
3. If nobody picks up or the call is declined, the original screens play and the microphone is released at once.
4. If she picks up, the call screen opens: she greets the player out loud, and the microphone starts listening.

During the call (`lib/voice/session.js`):

* **Listening**: streaming speech recognition shows nothing to read, it only decides when the player has finished (a short pause, longer after an unfinished phrase).
* **Her reply** streams from the AI; each sentence is spoken as soon as it is complete, so she starts talking after the first sentence, not the whole answer.
* **Interrupting**: if the player speaks over her, her voice stops immediately and the AI request is cancelled. Only what she actually got to say is kept in the conversation memory. Her own voice leaking from the speaker into the microphone is recognised and ignored.
* **Memory**: the conversation is kept in the browser and sent with each turn; the server keeps no call state. Retrying after a dropped connection sends the same history, so nothing is duplicated.
* **Safety**: every turn is tied to the player's own answered call home (`lib/voice/parentCall.js`), rate limited per player and per call, and the call has a maximum length.
* **Never stuck**: every wait has a timeout. No reply in 14 s means one retry, then the call ends with a message. A silent player gets two check-ins from her, then the call ends.

Call controls: mute, speaker, end call and the call timer. States shown: Connecting, Ringing, Connected, Listening, Speaking, Call ended (plus Muted).

## What is limited by browsers

* **Speech recognition** uses the browser's built-in engine (`SpeechRecognition`). It streams while the player talks, but it works in **Chrome, Edge and Safari** only. **Firefox cannot do voice calls**; the call explains this instead of starting. In Chrome the audio is processed by Google's speech service, so the player needs an internet connection and, on first use, microphone permission.
* **"Speaker"** cannot switch between earpiece and loudspeaker on the web (browsers do not allow it). The Speaker button changes the loudness of her voice.
* **Phones**: mobile browsers only play sound that follows a tap, which is why sound is unlocked in the call button's tap. If the browser still blocks it, the screen shows a "Tap to hear Mummy" button. Voice calls need the screen on; the game asks the phone to keep it awake during a call.
* **Echo**: use headphones for the best interruption experience. On speakerphone, echo cancellation in the browser handles most of it, and the game also ignores words that match what she is currently saying.

## Files

* `lib/voice/persona.js` her personality prompt, sentence splitting, echo and end-of-turn rules (pure, tested)
* `lib/voice/provider.js` the AI and optional voice provider adapters (server only)
* `lib/voice/parentCall.js` ties a voice turn to the player's own call (server only)
* `lib/voice/session.js` the call state machine: listening, interrupting, mute, timeouts, retries
* `lib/voice/speaker.js`, `lib/voice/client.js` her voice output, the microphone, the streaming client
* `lib/voice/playerVoice.js`, `lib/voice/rtcRelay.js` voice between players (WebRTC, and the server-side relay)
* `src/app/api/voice/{status,parent,speak}/route.js` the server endpoints
* `components/VoiceCall.js`, `components/voice-call.css` the call screen
* `tests/voice.test.mjs` the automated tests

## Checking it by hand

The automated tests cover the rules (turn-taking, interruption, mute, timeouts, retries, security checks). They cannot hear a microphone or judge a voice, so these need a person on a real device:

1. Set the three `VOICE_LLM_*` variables, deploy, and open Calls. Tap **Call Mummy** and allow the microphone.
2. Say something. She should answer out loud within a couple of seconds, and the status should read Listening while you talk and Speaking while she does.
3. Talk over her: she should stop at once and respond to what you said.
4. Mute: she should not react to you; unmute: she should again. Tap Speaker. End the call mid-sentence: she should cut off immediately.
5. Block the microphone in the browser settings and call again: you should see "Call not started" and still have your call.
6. Repeat on a phone (Android Chrome and iPhone Safari). Then open Messages, open a chat with an online friend on another device, tap the phone icon at the top, answer on the other device, and talk.
