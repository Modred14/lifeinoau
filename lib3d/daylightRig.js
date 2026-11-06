// lib3d/daylightRig.js
// Drives a three.js scene's lights, sky and fog from the game clock (see lib3d/daylight.js for the model). Browser only.
//
// The rig OWNS no objects: the caller creates the lights it already had (hemisphere, key, fill) and hands them in, so no light is ever added or removed while the game runs
// (that would recompile every material in the scene). Each frame it does almost nothing: the minute is read from the server-synced clock, and the scene is only
// touched when the minute has moved by 0.02 (about a second), so a frozen sky costs nothing and a moving one costs a handful of colour writes.
import * as THREE from "three";
import { serverTime } from "../lib/serverClock.js";
import { skyAt, minuteAt, followMinute, overrideMinute, setNightLevel, wrap } from "./daylight.js";

const STEP = 0.02; // game minutes between scene updates (= ~1.2 s of real time)
const PREFERS_REDUCED = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * scene: its background and fog are driven (a Color background and a Fog / FogExp2; anything else is left alone).
 * hemi, key, fill: the lights. key is the single shadow caster (the sun by day, the moon by night). fill is optional.
 * renderer: optional, for the exposure. dist: how far the key light sits from its target. fogDensity: the daytime density (FogExp2), night is a little thicker.
 */
export function createSkyRig({ scene, hemi, key, fill = null, renderer = null, dist = 130, fogDensity = null, fillDay = 0.6, fillNight = 0.1 }) {
  const col = new THREE.Color(), target = new THREE.Vector3(), listeners = new Set();
  let shown = overrideMinute() ?? minuteAt(serverTime()), applied = -1, sky = skyAt(shown);
  const set = (c, rgb) => c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);

  function apply(s) {
    sky = s; applied = s.minute;
    if (scene.background?.isColor) set(scene.background, s.sky);
    if (scene.fog) { set(scene.fog.color, s.sky); if (fogDensity != null && scene.fog.isFogExp2) scene.fog.density = fogDensity * (1 + 0.5 * s.night); }
    set(hemi.color, s.hemiSky); set(hemi.groundColor, s.hemiGround); hemi.intensity = s.hemiI;
    set(key.color, s.key.color); key.intensity = s.key.intensity;
    if (key.shadow && "intensity" in key.shadow) key.shadow.intensity = s.key.shadow;
    placeKey(s);
    if (fill) fill.intensity = fillDay * (1 - s.night) + fillNight * s.night;
    if (renderer) renderer.toneMappingExposure = s.exposure;
    setNightLevel(s.night);
    for (const f of listeners) f(s.night, s);
  }
  function placeKey(s) { key.position.set(target.x + s.key.dir.x * dist, target.y + s.key.dir.y * dist, target.z + s.key.dir.z * dist); key.target?.position.copy(target); }
  apply(sky);

  return {
    /** the current sky (the object skyAt returned) */
    get sky() { return sky; },
    /** the minute being shown (0..1440) */
    get minute() { return shown; },
    /** The key light follows what the camera looks at, so shadows stay sharp wherever the player is. Call it each frame. */
    follow(t) { if (t.x === target.x && t.y === target.y && t.z === target.z) return; target.copy(t); placeKey(sky); },
    /** Call once per frame. dt in seconds. */
    update(dt) {
      const want = overrideMinute() ?? minuteAt(serverTime());
      // glide to the right time (a late server offset, a tab that slept, a debug override) instead of snapping; with the clock steady this lands exactly
      shown = followMinute(shown, want, dt, PREFERS_REDUCED() ? 1e6 : 90);
      let d = Math.abs(wrap(shown) - applied); if (d > 720) d = 1440 - d;
      if (d >= STEP || applied < 0) apply(skyAt(shown));
    },
    /** Jump straight to a minute (tests and previews). */
    set(minute) { shown = wrap(minute); apply(skyAt(shown)); },
    /** Hear about the night level (0 day .. 1 night) now and whenever it changes: windows, lamps, anything that glows. Returns the unsubscribe. */
    onNight(f) { listeners.add(f); f(sky.night, sky); return () => listeners.delete(f); },
  };
}
