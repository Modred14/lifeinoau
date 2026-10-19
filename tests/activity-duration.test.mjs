// tests/activity-duration.test.mjs
// Every gameplay activity lasts exactly 15 seconds, on one shared constant, and the server will not finish one early.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ACTIVITIES } from "../lib/activities.js";
import { ACTIVITY_SECONDS, ACTIVITY_MS } from "../lib/activityTime.js";
import { shiftMs } from "../lib/jobs.js";
import { runMs } from "../lib/hustleSites.js";
import { msToFull } from "../lib/sleep.js";

assert.equal(ACTIVITY_SECONDS, 15); assert.equal(ACTIVITY_MS, 15000);
const ids = Object.keys(ACTIVITIES); assert.ok(ids.length > 0);
for (const id of ids) assert.equal(ACTIVITIES[id].sec, 15, id + " is not 15 s");
assert.equal(shiftMs({}), ACTIVITY_MS);
for (const k of ["delivery", "shop", "farm", "hustle"]) { const m = runMs(k); assert.ok(m === 0 || m === ACTIVITY_MS, k); }
assert.equal(msToFull({ energy: 0 }), ACTIVITY_MS);
const svc = fs.readFileSync(new URL("../lib/activityService.js", import.meta.url), "utf8");
assert.match(svc, /need\(now >= \+new Date\(run\.endsAt\), "It is not finished yet\."/, "early finish must be refused with no slack");
assert.ok(!/endsAt\) - 800/.test(svc));
console.log("OK  activity durations: " + ids.length + " activities, all exactly " + ACTIVITY_SECONDS + " s");
