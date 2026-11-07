// lib/audio/spatial.js
// Positional audio helpers on the game's own AudioContext (lib/sound.js owns it). The world is in metres: x east, z south, y up, the same axes the game uses,
// and Web Audio's listener is right-handed with +y up, so world coordinates go in as they are: a vehicle to the east of someone facing north is on their right.
export const SPEED_OF_SOUND = 343;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** A panner that makes a source quieter with distance (inverse law from `ref` metres) and places it left/right. Cheap "equalpower" panning, so many sources cost little. */
export function makePanner(ctx, { ref = 6, rolloff = 1.3, max = 240 } = {}) {
  const p = ctx.createPanner();
  p.panningModel = "equalpower"; p.distanceModel = "inverse"; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = max;
  return p;
}
export function setPannerPos(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);   // older Safari has no AudioParams here
}
/** The listener: where the player is (x, y, z) and which way the view faces on the ground (fx, fz). */
export function setListener(ctx, { x, y = 1.6, z, fx, fz }) {
  const L = ctx.listener, l = Math.hypot(fx, fz) || 1;
  if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx / l; L.forwardY.value = 0; L.forwardZ.value = fz / l; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(x, y, z); L.setOrientation(fx / l, 0, fz / l, 0, 1, 0); }
}
/**
 * The pitch ratio the listener hears from a moving source (Doppler). Positions and velocities are on the ground (m, m/s).
 * Approaching raises the pitch, receding lowers it; it is exactly 1 when the source passes straight across. `boost` exaggerates it a little (games usually do).
 */
export function dopplerRatio(lx, lz, lvx, lvz, sx, sz, svx, svz, boost = 1.4) {
  const dx = sx - lx, dz = sz - lz, d = Math.hypot(dx, dz); if (d < 1) return 1;
  const ux = dx / d, uz = dz / d, vL = lvx * ux + lvz * uz, vS = svx * ux + svz * uz;   // + means: the listener moves towards the source / the source moves away
  const r = (SPEED_OF_SOUND + vL) / (SPEED_OF_SOUND + vS);
  return clamp(1 + (r - 1) * boost, 0.8, 1.25);
}
/** How bright a source sounds: sound loses its highs with distance (air absorbs them), so far things are muffled. Returns a low-pass cutoff in Hz. */
export const airCutoff = (dist) => clamp(19000 / (1 + dist / 14), 700, 19000);

/** One looped buffer of pink-ish noise per context, shared by every layer that needs noise (never rebuilt, never downloaded). */
const noiseCache = new WeakMap();
export function sharedNoise(ctx) {
  let b = noiseCache.get(ctx); if (b) return b;
  const len = Math.floor(ctx.sampleRate * 4); b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;   // Paul Kellet's pink filter
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
  noiseCache.set(ctx, b); return b;
}
/** A looping noise source starting at a random place in the shared buffer (so layers do not sound alike). */
export function noiseSource(ctx, rate = 1) { const s = ctx.createBufferSource(); s.buffer = sharedNoise(ctx); s.loop = true; s.playbackRate.value = rate; return s; }
export const startNoise = (s) => s.start(0, Math.random() * 3.5);
export { clamp };
