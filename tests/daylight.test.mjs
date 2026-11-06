// tests/daylight.test.mjs: the sky for every minute of the game day (lib3d/daylight.js)
import assert from "node:assert/strict";
import { skyAt, minuteAt, phaseOf, sunHeight, sunDirection, followMinute, wrap, setNightLevel, nightLevel, onNightLevel, toCss } from "../lib3d/daylight.js";

// the day is a loop: midnight has no seam
const a = skyAt(0), b = skyAt(1439.999);
for (const k of ["sunI", "hemiI", "moonI", "night", "exposure"]) assert.ok(Math.abs(a[k] - b[k]) < 0.01, `${k} jumps at midnight`);
assert.ok(a.sky.every((v, i) => Math.abs(v - b.sky[i]) < 1), "sky colour jumps at midnight");

// continuity: no step between two neighbouring minutes that the eye could catch. One game minute is a REAL minute (the clock is 1:1), so these are per 60 s of watching.
// the hand-over from sun to moon happens where the key light is at zero, so direction and shadow strength are only compared while it is actually lit
const lim = { sunI: 0.05, hemiI: 0.05, night: 0.05, sky: 6, keyI: 0.06, keyDir: 0.03, shadow: 0.02, exposure: 0.01 };
let last = skyAt(0); const worst = {};
const bump = (k, v) => (worst[k] = Math.max(worst[k] ?? 0, v));
for (let m = 1; m <= 1440; m++) {
  const s = skyAt(m);
  bump("sunI", Math.abs(s.sunI - last.sunI)); bump("hemiI", Math.abs(s.hemiI - last.hemiI)); bump("night", Math.abs(s.night - last.night));
  bump("sky", Math.max(...s.sky.map((v, i) => Math.abs(v - last.sky[i])))); bump("keyI", Math.abs(s.key.intensity - last.key.intensity));
  if (Math.min(s.key.intensity, last.key.intensity) > 0.02) bump("keyDir", Math.hypot(s.key.dir.x - last.key.dir.x, s.key.dir.y - last.key.dir.y, s.key.dir.z - last.key.dir.z)); if (Math.min(s.key.intensity, last.key.intensity) > 0.02) bump("shadow", Math.abs(s.key.shadow - last.key.shadow)); bump("exposure", Math.abs(s.exposure - last.exposure));
  last = s;
}
for (const k of Object.keys(lim)) assert.ok(worst[k] < lim[k], `${k} changes too fast between two minutes (${worst[k]?.toFixed(4)} >= ${lim[k]})`);

// the sun is where it should be
assert.ok(Math.abs(sunHeight(390)) < 1e-9 && Math.abs(sunHeight(1110)) < 1e-9, "sunrise 6:30 and sunset 6:30 PM are on the horizon");
assert.ok(sunHeight(750) > 0.999, "noon is the highest point");
assert.ok(sunDirection(540).x > 0 && sunDirection(960).x < 0, "the sun is in the east in the morning and the west in the afternoon");
assert.ok(sunDirection(0).y < 0 && skyAt(0).moonDir.y > 0, "at midnight the sun is below the ground and the moon is up");
for (const m of [0, 100, 390, 750, 1110, 1300]) { const d = sunDirection(m); assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9, "direction is a unit vector"); }

// brightness and night follow the sun
assert.equal(skyAt(750).night, 0, "no lamps at noon");
assert.equal(skyAt(0).night, 1, "lamps on at midnight");
assert.ok(skyAt(750).sunI > skyAt(480).sunI && skyAt(480).sunI > skyAt(380).sunI, "the sun gets stronger from dawn to noon");
assert.ok(skyAt(0).sunI === 0, "no sunlight at night");
for (let m = 1100; m < 1180; m++) { const x = skyAt(m), y = skyAt(m + 1); if (x.key.dir.x * y.key.dir.x < 0 || Math.hypot(x.key.dir.x - y.key.dir.x, x.key.dir.y - y.key.dir.y) > 0.1) assert.ok(Math.max(x.key.intensity, y.key.intensity) < 0.02, `the key light swings to the moon while it is still lit (minute ${m})`); }
assert.ok(skyAt(0).key.intensity > 0 && skyAt(0).key.intensity < 1.5 && skyAt(0).key.dir.y > 0.3, "at night the key light is the faint moon, up in the sky");
assert.ok(skyAt(750).key.shadow > 0.99 && skyAt(0).key.shadow < 0.5, "crisp shadows at noon, faint ones from the moon");
assert.ok(skyAt(1100).key.dir.y >= 0.18 - 1e-9 && skyAt(400).key.dir.y >= 0.18 - 1e-9, "a low sun never throws endless shadows");
assert.ok(skyAt(540).key.dir.x > 0 && skyAt(960).key.dir.x < 0, "shadows fall west in the morning and east in the afternoon");
assert.ok(skyAt(1050).night < 0.2 && skyAt(1140).night > 0.7, "the lamps come on around sunset, not at 4 PM and not at 9 PM");
assert.ok(skyAt(330).night > 0.9 && skyAt(420).night < 0.1, "the lamps go out around sunrise");
assert.ok(skyAt(1110).sky[0] > skyAt(1110).sky[2], "the sunset sky is warm (more red than blue)");
assert.ok(skyAt(750).sky[2] > skyAt(750).sky[0], "the midday sky is blue");
assert.equal(toCss(skyAt(750).sky), "#a9cbe8", "noon keeps the original map background");

// the minute carries the seconds, and follows the game clock's own zone (Lagos, UTC+1): 12:00:00 UTC is 1 PM game time
assert.ok(Math.abs(minuteAt(Date.UTC(2026, 10, 5, 12, 0, 30)) - 780.5) < 1e-6, "minuteAt = game minute + seconds");

// the named stretches of the day
const phases = { 0: "late-night", 330: "early-morning", 480: "morning", 750: "afternoon", 1040: "evening", 1110: "sunset", 1200: "night", 1400: "late-night" };
for (const [m, p] of Object.entries(phases)) assert.equal(phaseOf(+m), p, `minute ${m}`);
assert.equal(new Set(Array.from({ length: 1440 }, (_, m) => phaseOf(m))).size, 7, "all seven phases occur in a day");

// following the clock: glides to a new time, takes the short way round midnight, lands exactly
assert.equal(followMinute(100, 100, 0.016), 100);
assert.equal(followMinute(100, 100.02, 0.016), 100.02);
assert.ok(followMinute(100, 200, 0.5) > 100 && followMinute(100, 200, 0.5) < 200, "a big difference is closed gradually");
assert.ok(wrap(followMinute(1430, 10, 0.05)) > 1430 || wrap(followMinute(1430, 10, 0.05)) < 10, "goes forward through midnight, not back across the whole day");
assert.equal(followMinute(10, 1430, 0.05) < 10 || followMinute(10, 1430, 0.05) > 1430, true);

// the shared night level
let heard = []; const off = onNightLevel((v) => heard.push(v));
setNightLevel(0.5); setNightLevel(0.5); setNightLevel(0.5005); setNightLevel(0.9); off(); setNightLevel(0);
assert.deepEqual(heard, [0.5, 0.9], "subscribers hear real changes only");
assert.equal(nightLevel(), 0);

console.log("daylight: ok");
