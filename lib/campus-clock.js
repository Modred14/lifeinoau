export const CAMPUS_MINUTE_MS = 2000;
export const CAMPUS_WEEK_MINUTES = 7 * 24 * 60;
export function weekAt(clock, now = Date.now()) {
  if (clock.campusEpoch && clock.campusStartWeek != null) return clock.campusStartWeek + Math.max(0, Math.floor((now - new Date(clock.campusEpoch).getTime()) / (CAMPUS_MINUTE_MS * CAMPUS_WEEK_MINUTES)));
  return Math.floor((now - new Date(clock.startedAt).getTime()) / (7 * 86400000)) + 1;
}
