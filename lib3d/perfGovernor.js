// lib3d/perfGovernor.js
// Keeps the 3D world smooth on weak phones: if frames keep taking too long it lowers the render resolution a step (the picture gets a
// little softer, the movement stays smooth); once the device has been comfortably fast for a while it goes back up. Pure maths with no
// browser or 3D library, so it is tested in Node (tests/perf-governor.test.mjs). lib3d/stage.js feeds it every frame.
//
//  - Only the pixel ratio changes. Nothing about the game (movement, physics, timing) depends on it.
//  - Frames longer than `ignoreAbove` seconds (a tab that was hidden, a build that stalled the thread) are not counted as "slow".
//  - After a change it waits `cooldown` frames before judging again, so the picture never flickers between two sizes.
export function createGovernor({ max = 1.75, min = 0.75, step = 0.25, slowMs = 25, fastMs = 15, slowFrames = 45, fastFrames = 240, cooldown = 90, ignoreAbove = 0.25 } = {}) {
  let ratio = max, slow = 0, fast = 0, wait = 0, avg = 16.7;
  const clampTo = (v) => Math.max(min, Math.min(max, v));
  return {
    get ratio() { return ratio; },
    get avgMs() { return avg; },
    /** Feed one frame (seconds). Returns the new pixel ratio when it changed, otherwise null. */
    frame(dt) {
      if (!(dt > 0) || dt > ignoreAbove) { slow = fast = 0; return null; }
      const ms = dt * 1000; avg += (ms - avg) * 0.1;
      if (wait > 0) { wait--; return null; }
      if (avg > slowMs) { slow++; fast = 0; } else if (avg < fastMs) { fast++; slow = 0; } else { slow = Math.max(0, slow - 1); fast = Math.max(0, fast - 1); }
      let next = ratio;
      if (slow >= slowFrames && ratio > min) next = clampTo(ratio - step);
      else if (fast >= fastFrames && ratio < max) next = clampTo(ratio + step);
      if (next === ratio) return null;
      ratio = next; slow = fast = 0; wait = cooldown; return ratio;
    },
    /** The ceiling changed (the window moved to a sharper screen): never sit above it. */
    setMax(v) { max = v; if (ratio > max) ratio = max; min = Math.min(min, max); },
  };
}
