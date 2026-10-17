import assert from "node:assert/strict";
import { weekAt, CAMPUS_MINUTE_MS, CAMPUS_WEEK_MINUTES } from "../lib/campus-clock.js";
import { dayWindow } from "../lib/clock.js";

const epoch = Date.UTC(2026, 9, 17);
const clock = { startedAt: new Date(epoch - 90 * 86400000), campusEpoch: new Date(epoch), campusStartWeek: 13 };
const weekMs = CAMPUS_MINUTE_MS * CAMPUS_WEEK_MINUTES;
assert.equal(weekAt(clock, epoch), 13);
assert.equal(weekAt(clock, epoch + weekMs - 1), 13);
assert.equal(weekAt(clock, epoch + weekMs), 14);
assert.equal(weekAt(clock, epoch + 12 * weekMs), 25);
const db = { gameClock: { findUnique: async () => clock } };
const day = await dayWindow(db, epoch + 2880000);
assert.deepEqual(day, { day: 2, start: epoch + 2880000, end: epoch + 5760000 });
assert.equal(weekAt({ startedAt: new Date(epoch) }, epoch + 7 * 86400000), 2);
console.log("Campus week preserves migrated progress and shares the accelerated day boundary.");
