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
//
// ONE setting decides the zone: GAME_TIME_ZONE (an IANA name; set NEXT_PUBLIC_GAME_TIME_ZONE to move the whole game, server and browser alike). Every clock the
// player can see (the phone, the status bar, the club chip, message times) and every rule that depends on the time of day (club hours) goes through the helpers
// below, so what the screen says and what the server enforces can never disagree, and none of them reads the device's own zone.
let ENV_ZONE; try { ENV_ZONE = process.env.NEXT_PUBLIC_GAME_TIME_ZONE; } catch { /* no process: the default zone */ } // written out in full so Next can inline it in the browser too
const validZone = (z) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; } };
export const GAME_TIME_ZONE = ENV_ZONE && validZone(ENV_ZONE) ? ENV_ZONE : "Africa/Lagos"; // the same zone as an Intl option, for showing the time in the browser
/** The zone's offset from UTC in minutes at `now` (60 for Lagos). Exact for any zone, daylight saving included. */
export function zoneOffsetMin(now = Date.now(), zone = GAME_TIME_ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(now / 1000) * 1000) / GAME_MINUTE_MS);
}
export const GAME_UTC_OFFSET_MIN = zoneOffsetMin(Date.UTC(2026, 0, 1)); // kept for old imports: the zone's standard offset (60 for Lagos)

/** Minutes since game-midnight at `now` (ms): 0..1439. */
export function gameMinuteOfDay(now = Date.now()) {
  const m = Math.floor(now / GAME_MINUTE_MS) + zoneOffsetMin(now);
  return ((m % 1440) + 1440) % 1440;
}

/** The ms timestamp of the next game-clock `minuteOfDay` (0..1439) strictly after `now`. */
export function nextGameTime(minuteOfDay, now = Date.now()) {
  const nowMin = gameMinuteOfDay(now), startOfMinute = Math.floor(now / GAME_MINUTE_MS) * GAME_MINUTE_MS;
  let wait = minuteOfDay - nowMin; if (wait <= 0) wait += 1440;
  return startOfMinute + wait * GAME_MINUTE_MS;
}

/** Short zone name for labels: "WAT" for Lagos, otherwise whatever Intl calls it ("GMT+1" is shown as WAT only for Africa/Lagos). */
export function gameZoneLabel(now = Date.now()) {
  if (GAME_TIME_ZONE === "Africa/Lagos") return "WAT";
  try { return new Intl.DateTimeFormat("en", { timeZone: GAME_TIME_ZONE, timeZoneName: "short" }).formatToParts(new Date(now)).find((x) => x.type === "timeZoneName")?.value ?? GAME_TIME_ZONE; } catch { return GAME_TIME_ZONE; }
}
/** "10:10 PM" in game time, whatever zone the device is in. */
export const gameClockText = (now = Date.now()) => new Date(now).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: GAME_TIME_ZONE }).replace(/\s?(am|pm)/i, (m) => " " + m.trim().toUpperCase());
/** "10:10 PM WAT": what a club chip or a notice shows, so the player can see which clock the hours are on. */
export const gameClockWithZone = (now = Date.now()) => `${gameClockText(now)} ${gameZoneLabel(now)}`;
/** Hour (0..23) and day-of-month of `now` in game time. */
export const gameHour = (now = Date.now()) => Math.floor(gameMinuteOfDay(now) / 60);
export function gameDayOfMonth(now = Date.now()) { return +new Intl.DateTimeFormat("en-US", { timeZone: GAME_TIME_ZONE, day: "numeric" }).format(new Date(now)); }
/** True from 7 PM to 6 AM game time (the phone's night mode). */
export const isGameNight = (now = Date.now()) => { const h = gameHour(now); return h >= 19 || h < 6; };
