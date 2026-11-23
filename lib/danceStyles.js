// lib/danceStyles.js
// The dance styles a player can choose on a club floor. Plain data, shared by the server (which only accepts these ids), the club menu and the 3D scene.
// `clip` is the animation name the avatar plays (lib3d/avatar/danceClips.js bakes them from the skeleton; a clip of the same name in an authored model wins).
// `authored: "code"` means the motion is choreographed in code, not captured from a dancer: it is an approximation and is swappable by dropping in a real clip.
export const DANCE_STYLES = [
  { id: "groove", label: "Party groove", clip: "idleEmote", icon: "music", blurb: "Hands up, hands on chest, low sweeps: the easy all-night dance.", authored: "code" },
  { id: "bounce", label: "Two-step bounce", clip: "danceBounce", icon: "music", blurb: "A steady bounce from foot to foot with pumping arms.", authored: "code" },
  { id: "sway", label: "Hip sway", clip: "danceSway", icon: "sound", blurb: "Smooth side-to-side hip movement with a gentle twist.", authored: "code" },
  { id: "legwork", label: "Legwork", clip: "danceLegwork", icon: "person", blurb: "Fast footwork with shoulder shrugs.", authored: "code" },
  { id: "oblee", label: "Ọ̀blee", clip: "danceOblee", icon: "sparkle", blurb: "High-energy Lagos street-dance: low stance, quick feet, arms driving high and low.", authored: "code" },
];
/** Seconds a dance stays "on" for other players unless the dancer's screen renews it (so a closed tab never leaves a ghost dancing). */
export const DANCE_LEASE_SEC = 25;
/** How often the dancer's screen renews the lease. */
export const DANCE_RENEW_SEC = 10;
const BY_ID = new Map(DANCE_STYLES.map((s) => [s.id, s]));
export const danceById = (id) => BY_ID.get(String(id ?? "")) ?? null;
export const isDanceId = (id) => BY_ID.has(String(id ?? ""));
/** The animation names for a style, in the order a viewer's avatar tries them (falls back to the party groove, then to idle). */
export const danceAnimFor = (id) => { const s = danceById(id); return s ? [s.clip, "idleEmote"] : null; };
