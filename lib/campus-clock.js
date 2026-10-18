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