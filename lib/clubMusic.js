// lib/clubMusic.js
// Everything about the club music that is DATA or a PURE RULE: the genres, the in-house tracks, the catalogue of Nigerian party hits, the licensed-audio
// manifest and its checks, how a night's set is put together, and how one track is mixed into the next. No browser APIs, so Node tests can check it.
// The audio itself is made by lib/clubDj.js (Web Audio) from these rules.
//
// WHAT PLAYS, AND WHY IT IS LEGAL
//   1. The in-house mix (SYNTH_TRACKS): afrobeats, amapiano, street-pop and afro-lounge grooves that the game generates itself in the browser. They are original
//      rhythms and are never labelled as anybody's song. This is what makes the clubs sound alive even before any licensed audio exists.
//   2. Licensed or authorised audio (public/audio/club/manifest.json): when the project adds a file or an authorised preview there, with a note saying where the
//      permission comes from, it joins the same mix with the same transitions. HITS below is only a catalogue of well-known Nigerian party tracks (title and
//      artist) that an entry can point at with `hit`. A song with no manifest entry has no audio and is never played, so nothing here bundles copyrighted music.
export const STORAGE_KEY = "lifeinoau:club-music";

export const GENRES = {
  afrobeats: { label: "Afrobeats", bpm: [98, 106] },
  amapiano: { label: "Amapiano", bpm: [108, 114] },
  streetpop: { label: "Street-pop", bpm: [96, 102] },
  lounge: { label: "Afro lounge", bpm: [90, 98] },
};

// ------------------------------------------------------------------------------------------------ the clubs' sets
/** `genres` are weights, `dj` is the resident DJ's (fictional) name shown for the in-house mix, `energy` is how the night builds (1 chill, 5 peak). */
export const CLUB_SETS = {
  club_quantum: { dj: "DJ Neon Ife", genres: { amapiano: 3, afrobeats: 2, streetpop: 1 }, energy: [3, 3, 4, 4, 5, 5, 4, 5, 3, 4, 5, 3], note: "Amapiano log drums and big-room afrobeats" },
  club_0203: { dj: "DJ Harmattan", genres: { streetpop: 3, afrobeats: 3, amapiano: 1 }, energy: [2, 3, 3, 4, 5, 4, 5, 5, 4, 3, 5, 3], note: "Street-pop energy and campus afrobeats" },
  club_divas: { dj: "DJ Gold Mara", genres: { lounge: 3, afrobeats: 3, amapiano: 2 }, energy: [2, 2, 3, 3, 4, 5, 4, 3, 5, 4, 3, 2], note: "Afro lounge, luxury afrobeats and smooth amapiano" },
};
export const setOf = (clubId) => CLUB_SETS[clubId] ?? CLUB_SETS.club_quantum;

// ------------------------------------------------------------------------------------------------ in-house tracks
// root = MIDI note of the bass root; prog = four chord roots in semitones above it (one chord a bar); minor = the chords are minor; energy 1-5; bars = length.
const T = (id, title, genre, bpm, root, prog, energy, minor = true, bars = 32) => ({ id, title, genre, bpm, root, prog, energy, minor, bars, kind: "synth" });
export const SYNTH_TRACKS = [
  T("lagos-after-dark", "Lagos After Dark", "afrobeats", 102, 45, [0, 8, 3, 10], 4),
  T("danfo-dreams", "Danfo Dreams", "afrobeats", 100, 43, [0, 5, 8, 7], 3),
  T("ife-midnight", "Ile-Ife Midnight", "afrobeats", 104, 47, [0, 3, 8, 10], 5),
  T("owambe-lights", "Owambe Lights", "afrobeats", 98, 48, [0, 7, 5, 3], 3, false),
  T("log-drum-theory", "Log Drum Theory", "amapiano", 112, 45, [0, 8, 5, 10], 5),
  T("sunday-keys", "Sunday Keys", "amapiano", 110, 41, [0, 5, 3, 7], 3),
  T("quantum-shift", "Quantum Shift", "amapiano", 113, 46, [0, 3, 10, 8], 5),
  T("moremi-groove", "Moremi Groove", "amapiano", 109, 44, [0, 7, 8, 3], 4),
  T("street-gospel", "Street Gospel", "streetpop", 99, 40, [0, 8, 10, 7], 5),
  T("ajegunle-run", "Ajegunle Run", "streetpop", 97, 42, [0, 3, 5, 10], 4),
  T("main-gate-flex", "Main Gate Flex", "streetpop", 101, 38, [0, 8, 3, 7], 5),
  T("hall-six-anthem", "Hall Six Anthem", "streetpop", 96, 41, [0, 5, 8, 10], 3),
  T("velvet-harmattan", "Velvet Harmattan", "lounge", 94, 44, [0, 5, 8, 3], 2),
  T("gold-hour", "Gold Hour", "lounge", 92, 46, [0, 7, 3, 8], 2, false),
  T("marble-floor", "Marble Floor", "lounge", 96, 43, [0, 3, 8, 5], 3),
  T("champagne-motion", "Champagne Motion", "lounge", 98, 45, [0, 8, 5, 10], 4),
];

// ------------------------------------------------------------------------------------------------ catalogue of Nigerian party hits (metadata only)
// A manifest entry can say `hit: "<id>"` to take its title, artist and genre from here. No audio is attached to any of these.
const H = (id, title, artist, genre) => ({ id, title, artist, genre });
export const HITS = [
  H("asake-gratitude", "Gratitude", "Asake", "lounge"), H("burna-way-too-big", "Way Too Big", "Burna Boy", "afrobeats"),
  H("asake-sungba-remix", "Sungba (Remix)", "Asake ft. Burna Boy", "streetpop"), H("asake-amapiano", "Amapiano", "Asake ft. Olamide", "amapiano"),
  H("asake-terminator", "Terminator", "Asake", "streetpop"), H("asake-pbuy", "Peace Be Unto You (PBUY)", "Asake", "streetpop"),
  H("spinall-palazzo", "Palazzo", "Spinall ft. Asake", "afrobeats"), H("asake-wa", "Wa", "Asake", "afrobeats"),
  H("asake-forgiveness", "Forgiveness", "Asake", "afrobeats"), H("asake-mcbh", "MCBH", "Asake", "streetpop"),
  H("worship", "WORSHIP", "DJ Snake & Asake", "afrobeats"), H("elumelu", "Elumelu", "Young Jonn", "afrobeats"),
  H("big-bum-bum", "Big Bum Bum", "Kidd Carder & Mavo", "afrobeats"), H("back-outside", "Back Outside", "BNXN & Sarz", "afrobeats"),
  H("fresh", "FRE$H", "Victony", "streetpop"), H("slick", "SLICK", "Victony", "afrobeats"),
  H("gwagwalada", "GWAGWALADA", "BNXN, Kizz Daniel & Seyi Vibez", "streetpop"), H("motion-sickness", "MOTION SICKNESS", "ODUMODUBLVCK ft. Zlatan", "streetpop"),
  H("dai-dai", "Dai Dai", "Shakira & Burna Boy", "afrobeats"), H("body-danz", "BODY (danz)", "CKay & Mavo", "afrobeats"),
  H("asambe", "Asambe", "Kabza De Small & Asake", "amapiano"),
];
export const hitById = (id) => HITS.find((h) => h.id === id) ?? null;

// ------------------------------------------------------------------------------------------------ the licensed-audio manifest
const text = (v) => (typeof v === "string" ? v.trim() : "");
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
/** A src must be a path on this site or an https URL, never a relative climb or another scheme. */
export const okSrc = (s) => typeof s === "string" && !s.includes("..") && (/^\/[^/\\]/.test(s) || /^https:\/\/[^\s]+$/.test(s));

/** Check the manifest. Returns { tracks, rejected }: `tracks` are ready to mix; an entry with no title, artist, usable src or license note is left out and listed in `rejected`. */
export function normalizeManifest(m) {
  const tracks = [], rejected = [], seen = new Set();
  for (const [i, raw] of (Array.isArray(m?.tracks) ? m.tracks : []).entries()) {
    const hit = raw && raw.hit ? hitById(raw.hit) : null, title = text(raw?.title) || hit?.title || "", artist = text(raw?.artist) || hit?.artist || "";
    const id = text(raw?.id) || hit?.id || `track-${i}`;
    const why = !title || !artist ? "needs a title and an artist" : !okSrc(raw?.src) ? "src must be a /path on this site or an https URL" : !text(raw?.license) ? "needs a license note saying where the permission comes from" : seen.has(id) ? "duplicate id" : null;
    if (why) { rejected.push({ id, why }); continue; }
    seen.add(id);
    const start = num(raw.start, 0, 36000), end = num(raw.end, 0, 36000);
    tracks.push({ kind: "file", id, title, artist, genre: GENRES[raw.genre] ? raw.genre : hit?.genre ?? "afrobeats", src: raw.src, license: text(raw.license), energy: num(raw.energy, 1, 5) ?? 4,
      bpm: num(raw.bpm, 60, 200), firstBeat: num(raw.firstBeat, 0, 60) ?? 0, start: start ?? 0, end: end != null && end > (start ?? 0) + 5 ? end : null, preview: raw.preview === true });
  }
  return { tracks, rejected };
}

// ------------------------------------------------------------------------------------------------ small pure helpers
export function hashSeed(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** How far apart two tempos are as a fraction, counting half-time and double-time as the same groove (a 56 BPM track sits on a 112 one). */
export const tempoGap = (a, b) => { if (!a || !b) return 1; const rel = (x) => Math.abs(x - 1); return Math.min(rel(a / b), rel(a / (2 * b)), rel((2 * a) / b)); };
export const barSeconds = (bpm, beats = 4) => (beats * 60) / bpm;
/** The time (seconds) of the first bar line at or after `now`, on a grid that starts at `firstBeat`. */
export function nextBarTime(now, firstBeat, bpm, beats = 4) { const bar = barSeconds(bpm, beats), k = Math.max(0, Math.ceil((now - firstBeat) / bar - 1e-9)); return firstBeat + k * bar; }
/** Equal-power crossfade: at every point out² + in² = 1, so the mix never dips or jumps in loudness. k runs 0..1. */
export const crossfadeGains = (k) => { const x = Math.min(1, Math.max(0, k)); return { out: Math.cos((x * Math.PI) / 2), in: Math.sin((x * Math.PI) / 2) }; };
/** The playback rate that makes `inBpm` sit on `outBpm` (tempo only: the browser keeps the pitch), limited to a small stretch so it never sounds odd. */
export function tempoMatch(outBpm, inBpm, maxStretch = 0.06) {
  if (!outBpm || !inBpm) return { rate: 1, ok: false };
  const r = outBpm / inBpm, near = [r, r * 2, r / 2].reduce((best, c) => (Math.abs(c - 1) < Math.abs(best - 1) ? c : best));
  const ok = Math.abs(near - 1) <= maxStretch; return { rate: ok ? near : 1, ok };
}

// ------------------------------------------------------------------------------------------------ building a night's set
export const SET_LENGTH = 14;
/** An ordered, rotating set for a club. Follows the club's energy arc, prefers tracks that mix cleanly with the one before, never repeats within the last few,
 *  and gives licensed tracks a little priority when there are any. The same (club, seed) always gives the same set, so it can be tested; the seed changes hourly. */
export function buildSet(clubId, seed, files = [], length = SET_LENGTH) {
  const club = setOf(clubId), rnd = rng(hashSeed(`${clubId}:${seed}`));
  const pool = [...SYNTH_TRACKS.filter((t) => club.genres[t.genre]), ...files.filter((f) => f.kind === "file")];
  const set = [];
  for (let i = 0; i < length; i++) {
    const target = club.energy[i % club.energy.length], prev = set[set.length - 1], recent = new Set(set.slice(-Math.min(6, pool.length - 1)).map((t) => t.id));
    let best = null, bestScore = -Infinity;
    for (const t of pool) {
      if (recent.has(t.id)) continue;
      const score = -Math.abs(t.energy - target) * 1.6 - (prev ? tempoGap(prev.bpm, t.bpm) * 14 : 0) + (club.genres[t.genre] ?? 1) * 0.5 + (t.kind === "file" ? 1.2 : 0) + rnd() * 1.6;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    set.push(best ?? pool[i % pool.length]);
  }
  return set;
}

// ------------------------------------------------------------------------------------------------ mixing one track into the next
export const EFFECTS = ["riser", "airhorn", "scratch", "rewind"];
/** About four mixes in ten get a one-off effect, never the same one twice running. */
export function pickEffect(rnd, last = null) { if (rnd() > 0.4) return null; const options = EFFECTS.filter((e) => e !== last); return options[Math.floor(rnd() * options.length)]; }
/** How to go from `out` to `inn`. With both tempos known and close: a beat-matched blend over 4 or 8 bars (both decks follow one tempo that glides across, the outgoing
 *  track's lows are swept out). Otherwise a plain equal-power crossfade of 6 to 9 seconds with a filter sweep. */
export function planTransition(out, inn, rnd, lastEffect = null) {
  const matched = !!(out?.bpm && inn?.bpm) && tempoGap(out.bpm, inn.bpm) <= 0.12;
  const bars = matched ? (rnd() < 0.5 ? 4 : 8) : 0, seconds = matched ? bars * barSeconds((out.bpm + inn.bpm) / 2) : 6 + rnd() * 3;
  return { type: matched ? "beatmatch" : "fade", bars, seconds, effect: pickEffect(rnd, lastEffect) };
}

/** What the player sees for a track. */
export function describeTrack(t, clubId) {
  if (!t) return null;
  const synth = t.kind === "synth", genre = GENRES[t.genre]?.label ?? "";
  return { id: t.id, title: t.title, artist: synth ? setOf(clubId).dj : t.artist, genre, source: synth ? "In-house mix" : t.preview ? "Authorised preview" : "Licensed track", bpm: t.bpm ?? null };
}