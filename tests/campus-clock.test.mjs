// tests/campus-clock.test.mjs
// tests/campus-clock.test.mjs: the game clock is strictly 1:1 with real time (one game minute = one real minute, a day = 24 h, a week = 7 days),
// derived from stored timestamps only, so a restart, a refresh or a reconnect can never move it.
import assert from "node:assert/strict";
import { weekAt, GAME_MINUTE_MS, CAMPUS_MINUTE_MS, CAMPUS_WEEK_MINUTES, GAME_DAY_MS, GAME_WEEK_MS } from "../lib/campus-clock.js";
import { dayWindow, currentWeek, serverNow } from "../lib/clock.js";

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
// the rate itself
assert.equal(GAME_MINUTE_MS, MIN, "one game minute is one real minute");
assert.equal(CAMPUS_MINUTE_MS, MIN, "the old name follows the same rate");
assert.equal(GAME_DAY_MS, DAY, "a game day is 24 real hours");
assert.equal(GAME_WEEK_MS, 7 * DAY, "a game week is 7 real days");
assert.equal(CAMPUS_WEEK_MINUTES * GAME_MINUTE_MS, GAME_WEEK_MS);

const epoch = Date.UTC(2026, 9, 16, 23); // 12:00 AM game time (WAT) on 17 October: game days and weeks start at game midnight
const clock = { startedAt: new Date(epoch - 90 * DAY), campusEpoch: new Date(epoch), campusStartWeek: 13 };
const weekMs = GAME_WEEK_MS;
assert.equal(weekAt(clock, epoch), 13);
assert.equal(weekAt(clock, epoch + weekMs - 1), 13);
assert.equal(weekAt(clock, epoch + weekMs), 14);
assert.equal(weekAt(clock, epoch + 12 * weekMs), 25);
assert.equal(weekAt(clock, epoch - DAY), 13, "never before the first week of the epoch");
// a clock row without an epoch counts from startedAt at the same rate
assert.equal(weekAt({ startedAt: new Date(epoch) }, epoch + 7 * DAY), 2);
assert.equal(weekAt({ startedAt: new Date(epoch) }, epoch + 7 * DAY - 1), 1);

// the day window: 24 real hours from the epoch
const db = { gameClock: { findUnique: async () => clock } };
assert.deepEqual(await dayWindow(db, epoch + 2 * MIN), { day: 1, start: epoch, end: epoch + DAY });
assert.deepEqual(await dayWindow(db, epoch + DAY + 5 * HOUR), { day: 2, start: epoch + DAY, end: epoch + 2 * DAY });
assert.deepEqual(await dayWindow(db, epoch + DAY - 1), { day: 1, start: epoch, end: epoch + DAY }, "the last millisecond of a day is still that day");

// time is derived from the server clock alone, so the same instant always gives the same answer (restart / refresh / reconnect / two clients)
const realNow = Date.now;
try {
  Date.now = () => epoch + 3 * weekMs + 2 * DAY;
  const a = await currentWeek(db), b = await currentWeek(db), w = await dayWindow(db);
  assert.equal(a, 16); assert.equal(a, b); assert.equal(w.day, 24, "day 24 counted from the epoch");
  assert.equal(serverNow(), epoch + 3 * weekMs + 2 * DAY, "serverNow is the server clock");
  // one real hour later: still the same day and week, exactly one real hour on
  Date.now = () => epoch + 3 * weekMs + 2 * DAY + HOUR;
  assert.equal(await currentWeek(db), 16); assert.equal((await dayWindow(db)).day, 24);
} finally { Date.now = realNow; }
console.log("Game clock is strictly 1:1 with real time and derived from stored timestamps.");
