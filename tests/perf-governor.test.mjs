// tests/perf-governor.test.mjs
// The resolution governor: slow frames lower it step by step, a long fast spell raises it again, odd frames are ignored, and it never flickers.
import assert from "node:assert/strict";
import { createGovernor } from "../lib3d/perfGovernor.js";

const run = (g, ms, n) => { let last = null; for (let i = 0; i < n; i++) { const r = g.frame(ms / 1000); if (r != null) last = r; } return last; };

{ const g = createGovernor(); assert.equal(run(g, 16, 2000), null); assert.equal(g.ratio, 1.75); console.log("OK   a device that keeps up is never touched"); }
{ const g = createGovernor(); const r = run(g, 40, 200); assert.ok(r < 1.75 && g.ratio < 1.75, "slow frames lower the resolution"); console.log("OK   slow frames lower the resolution"); }
{ const g = createGovernor(); run(g, 60, 5000); assert.equal(g.ratio, 0.75, "it stops at the floor"); console.log("OK   it never goes below the floor"); }
{ const g = createGovernor(); run(g, 40, 120); const low = g.ratio; run(g, 8, 3000); assert.ok(g.ratio > low, "a long fast spell raises it again"); assert.ok(g.ratio <= 1.75); console.log("OK   a long fast spell raises it back, never above the ceiling"); }
{ const g = createGovernor(); for (let i = 0; i < 500; i++) g.frame(3); assert.equal(g.ratio, 1.75, "stalls of seconds (hidden tab) are not slow frames"); console.log("OK   a stalled or hidden-tab frame is ignored"); }
{ const g = createGovernor(); const seen = []; for (let i = 0; i < 400; i++) { const r = g.frame(0.04); if (r != null) seen.push(i); } assert.ok(seen.length >= 2 && seen[1] - seen[0] >= 90, "a cool-down between two changes"); console.log("OK   changes are spaced out (no flicker)"); }
{ const g = createGovernor({ max: 2 }); g.setMax(1); assert.equal(g.ratio, 1); console.log("OK   a lower ceiling pulls the ratio down"); }
{ const g = createGovernor(); assert.equal(g.frame(NaN), null); assert.equal(g.frame(-1), null); assert.equal(g.frame(0), null); console.log("OK   junk frame times are ignored"); }
