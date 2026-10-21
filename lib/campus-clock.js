// lib/campus-clock.js
// The game clock runs strictly 1:1 with real time: one game minute is one real minute, a game day is 24 real hours and a game week is
// 7 real days. Nothing here ticks: every time is DERIVED from the server's wall clock against the epoch stored in the GameClock row, so a
// refresh, a logout, a server restart or a reconnect can never move it, and two clients can never disagree about it.
export const GAME_MINUTE_MS = 60_000;
export const CAMPUS_MINUTE_MS = GAME_MINUTE_MS; // old name, kept so existing imports keep working
export const GAME_DAY_MS = 1440 * GAME_MINUTE_MS;
export const CAMPUS_WEEK_MINUTES = 7 * 24 * 60;
export const GAME_WEEK_MS = GAME_MINUTE_MS * CAMPUS_WEEK_MINUTES;

/** The game week at `now` (ms). A clock row with an epoch counts from `campusStartWeek` at `campusEpoch`; an older row counts from `startedAt`. */
export function weekAt(clock, now = Date.now()) {
  if (clock.campusEpoch && clock.campusStartWeek != null) return clock.campusStartWeek + Math.max(0, Math.floor((now - new Date(clock.campusEpoch).getTime()) / GAME_WEEK_MS));
  return Math.floor((now - new Date(clock.startedAt).getTime()) / GAME_WEEK_MS) + 1;
}

// ---- time of day -------------------------------------------------------------------------------------------------------------------------
// The game is set in Ile-Ife, so its time of day is West Africa Time (UTC+1, no daylight saving). This is derived from the same wall clock as everything
// above (never a second clock), so the server and every browser agree on whether it is night, whatever the device's own time zone says.
export const GAME_UTC_OFFSET_MIN = 60;
export const GAME_TIME_ZONE = "Africa/Lagos"; // the same zone as an Intl option, for showing the time in the browser

/** Minutes since game-midnight at `now` (ms): 0..1439. */
export function gameMinuteOfDay(now = Date.now()) {
  const m = Math.floor(now / GAME_MINUTE_MS) + GAME_UTC_OFFSET_MIN;
  return ((m % 1440) + 1440) % 1440;
}

/** The ms timestamp of the next game-clock `minuteOfDay` (0..1439) strictly after `now`. */
export function nextGameTime(minuteOfDay, now = Date.now()) {
  const nowMin = gameMinuteOfDay(now), startOfMinute = Math.floor(now / GAME_MINUTE_MS) * GAME_MINUTE_MS;
  let wait = minuteOfDay - nowMin; if (wait <= 0) wait += 1440;
  return startOfMinute + wait * GAME_MINUTE_MS;
}