// lib3d/daylight.js
// The look of the sky for any minute of the game day. PURE: no three.js, no DOM, no clock of its own. The caller passes the minute
// (0..1440, game time = West Africa Time, from lib/campus-clock.js gameMinuteOfDay on the server-synced clock), so every player sees the same
// light at the same moment and nothing here can disagree with the clock on the phone.
//
// Everything is a continuous function of the minute: the sun is a point on an arc (rises in the east at 6:30, noon at 12:30, sets in the west at
// 18:30), and the colours are blended between a handful of keyframes with an eased curve, so there is no step anywhere in the day.

export const SUNRISE_MIN = 390, SUNSET_MIN = 1110; // 6:30 AM, 6:30 PM
import { gameMinuteOfDay } from "../lib/campus-clock.js";
const TAU = Math.PI * 2;
/** The game minute at `ms`, with the seconds as a fraction (0..1440). The light is driven by this, not by the whole minute, so it never moves in one-minute steps. */
export const minuteAt = (ms) => gameMinuteOfDay(ms) + (((ms % 60000) + 60000) % 60000) / 60000;

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ease = (k) => k * k * (3 - 2 * k);
export const smoothstep = (a, b, x) => ease(Math.min(1, Math.max(0, (x - a) / (b - a))));

// minute, sky (= horizon = fog), sun colour, sun intensity, hemisphere sky, hemisphere ground, hemisphere intensity, moon intensity, exposure.
// Key names are the phases the game talks about; `phase` below says which one a minute belongs to.
const K = (m, sky, sun, sunI, hs, hg, hI, moonI, exp) => ({ m, sky: hex(sky), sun: hex(sun), sunI, hs: hex(hs), hg: hex(hg), hI, moonI, exp });
const KEYS = [
  K(0, 0x070b18, 0xb7a8ff, 0, 0x2c3a68, 0x15171f, 0.42, 0.55, 1.0), // late night
  K(300, 0x0b1126, 0xb7a8ff, 0, 0x2f3d6e, 0x16181f, 0.44, 0.5, 1.0), // late night, the sky just beginning to pale
  K(360, 0x3b4672, 0xff9a62, 0.12, 0x56628f, 0x2b2a35, 0.7, 0.28, 1.02), // early morning: first light
  K(405, 0xe0a07c, 0xffa869, 1.0, 0x9fb0d6, 0x6f6458, 1.0, 0.0, 1.05), // sunrise glow
  K(480, 0xa7c6e3, 0xffe3bd, 2.2, 0xe4eeff, 0xb9bfae, 1.35, 0, 1.05), // morning
  K(750, 0xa9cbe8, 0xfff3e0, 2.8, 0xf3f8ff, 0xc3cbbd, 1.5, 0, 1.05), // noon: the original daytime look
  K(930, 0xa8c8e4, 0xffecd0, 2.55, 0xeaf2ff, 0xc0c3b2, 1.42, 0, 1.05), // afternoon
  K(1035, 0xd9ad85, 0xffc487, 1.7, 0xd9deee, 0xa9a08c, 1.15, 0, 1.04), // evening, golden
  K(1110, 0xc2667c, 0xff8442, 0.85, 0x8f86b4, 0x5d4f55, 0.8, 0.05, 1.03), // sunset
  K(1155, 0x4a3f70, 0xff7a4a, 0.14, 0x48508a, 0x25232f, 0.55, 0.3, 1.0), // dusk
  K(1230, 0x0d142b, 0xb7a8ff, 0, 0x2f3d6e, 0x16181f, 0.44, 0.5, 1.0), // night
  K(1440, 0x070b18, 0xb7a8ff, 0, 0x2c3a68, 0x15171f, 0.42, 0.55, 1.0), // back to late night: the same as minute 0, so midnight has no seam
];

/** Which named stretch of the day a minute is in. For labels and tests; the light itself never switches on these. */
export function phaseOf(minute) {
  const m = wrap(minute);
  if (m < 300 || m >= 1380) return "late-night"; // 11 PM to 5 AM
  if (m < 405) return "early-morning"; // 5 AM to 6:45 AM
  if (m < 690) return "morning"; // to 11:30 AM
  if (m < 1005) return "afternoon"; // to 4:45 PM
  if (m < 1080) return "evening"; // to 6 PM
  if (m < 1155) return "sunset"; // to 7:15 PM
  return "night"; // 7:15 PM to 11 PM
}

export const wrap = (m) => (m >= 0 && m < 1440 ? m : ((m % 1440) + 1440) % 1440);

/** The sun's height above the horizon as -1..1 (0 at sunrise and sunset, 1 at solar noon 12:30). */
export const sunHeight = (minute) => Math.cos(((wrap(minute) - 750) / 1440) * TAU);

/**
 * The unit vector from the ground towards the sun (x east, y up, z south) and towards the moon (opposite the sun, so it climbs as the sun sets).
 * The sun never sits exactly overhead (this is the tropics, but not the equinox) so shadows keep a direction at noon.
 */
export function sunDirection(minute) {
  const h = ((wrap(minute) - 750) / 1440) * TAU, e = Math.cos(h), x = -Math.sin(h), z = 0.28;
  const n = Math.hypot(x, e, z) || 1;
  return { x: x / n, y: e / n, z: z / n };
}

function keyAt(minute) {
  const m = wrap(minute);
  let i = 0; while (i < KEYS.length - 2 && m >= KEYS[i + 1].m) i++;
  const a = KEYS[i], b = KEYS[i + 1], k = ease((m - a.m) / (b.m - a.m));
  return { a, b, k };
}

/**
 * Everything the renderer needs for one minute. Colours are [r,g,b] 0..255 (the caller turns them into whatever it draws with).
 *  night   0 (day) .. 1 (full night): how much the lamps, windows and headlights are on. It ramps from about 6:05 PM (lamps warming up as the sun
 *          touches the horizon) to full by ~7 PM, and back down between ~5:30 and ~7 AM, so nothing switches in a single frame.
 *  sunI / moonI  light intensities; shadows are only worth drawing while sunShadow > 0.
 */
export function skyAt(minute) {
  const { a, b, k } = keyAt(minute), h = sunHeight(minute), d = sunDirection(minute);
  const night = 1 - smoothstep(-0.12, 0.1, h);
  const sunI = a.sunI + (b.sunI - a.sunI) * k, moonI = a.moonI + (b.moonI - a.moonI) * k, sunColor = mix(a.sun, b.sun, k);
  // ONE key light does the sun's job by day and the moon's by night. The scene keeps a single shadow-casting light all day (adding or removing a light would recompile every
  // material in the scene: a visible hitch), and a phone only ever renders one shadow map. The hand-over happens in the twilight, at the instant BOTH are at zero (the sun
  // is ~7 degrees below the horizon): the sun fades out, the key swings to the moon's side while it is dark, and the moon fades in. A shadow never sweeps across the ground.
  const sunPart = sunI * smoothstep(-0.12, -0.02, h), moonPart = moonI * 2.2 * smoothstep(-0.12, -0.22, h), moonD = { x: -d.x, y: Math.max(0.35, -d.y), z: -d.z };
  const byMoon = h < -0.12, dir = byMoon ? norm(moonD) : lowSun(d), intensity = byMoon ? moonPart : sunPart;
  return {
    minute: wrap(minute), phase: phaseOf(minute), height: h, night,
    sky: mix(a.sky, b.sky, k), sunColor, sunI, moonI,
    hemiSky: mix(a.hs, b.hs, k), hemiGround: mix(a.hg, b.hg, k), hemiI: a.hI + (b.hI - a.hI) * k, exposure: a.exp + (b.exp - a.exp) * k,
    sunDir: d, moonDir: moonD,
    key: {
      dir, intensity, color: byMoon ? MOON : sunColor, // moonlight is faint, but the eye adapts: a little more than the raw number
      // how dark the shadow is: crisp at midday, softer as the sun gets low, and a faint, pale one from the moon
      shadow: byMoon ? 0.4 : 0.55 + 0.45 * smoothstep(0, 0.4, h),
    },
  };
}
const MOON = hex(0xb7a8ff);
const norm = (v) => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
/** A sun right on the horizon would throw shadows of infinite length: keep it at least ~10 degrees up for the purposes of the shadow. */
const lowSun = (d) => { if (d.y >= 0.18) return d; const k = Math.sqrt(1 - 0.18 * 0.18) / (Math.hypot(d.x, d.z) || 1); return { x: d.x * k, y: 0.18, z: d.z * k }; };

/** [r,g,b] 0..255 -> 0xrrggbb */
export const toHex = (c) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
/** [r,g,b] 0..255 -> "#rrggbb" */
export const toCss = (c) => "#" + toHex(c).toString(16).padStart(6, "0");

/**
 * How the displayed minute follows the real one. The clock itself never jumps, but the server offset can arrive a moment after the first frame (or a tab can wake after a
 * long sleep): then the light should glide to the right time instead of snapping. `step` moves `shown` toward `target` by at most `rate` minutes per second, the short way
 * round midnight; a difference of under a few seconds of game time lands exactly.
 */
export function followMinute(shown, target, dt, rate = 90) {
  let d = wrap(target - shown); if (d > 720) d -= 1440;
  const max = rate * Math.max(0, dt);
  return Math.abs(d) <= max ? wrap(target) : wrap(shown + Math.sign(d) * max);
}

// ---- the shared night level -------------------------------------------------------------------------------------------------------------------------------
// The map lighting rig writes the current level here once per update; things that are built elsewhere (the cars, which are made per trip and per traffic entry)
// read it when they are created, and subscribe to hear about changes. A module-level value is enough: there is one sky at a time.
let level = 0; const subs = new Set();
export const nightLevel = () => level;
export function setNightLevel(v) { if (v === level || (Math.abs(v - level) < 0.004 && v !== 0 && v !== 1)) return; level = v; for (const f of subs) f(v); }
export function onNightLevel(f) { subs.add(f); return () => subs.delete(f); }

/** Test / preview hook: set globalThis.__oauMinute (0..1439) to freeze the sky at that game minute, or delete it to go back to the real clock. Never set by the game. */
export const overrideMinute = () => { const v = globalThis.__oauMinute; return Number.isFinite(v) ? v : null; };
