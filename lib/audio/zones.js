// lib/audio/zones.js
// What the town sounds like where the listener is (pure JS). Not a set of hard zones with a click at the border: every kind of sound has a weight from 0 to 1 that rises
// smoothly with how close the things that cause it are (a shop front, a hostel, the lecture halls, a busy road, the expressway), so walking from the faculty buildings
// to the market fades one soundscape into the other. ambience.js turns the weights into sound.
const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
/** 1 at the place, 0 at `r` metres. */
const near = (d, r) => sm(1 - d / r);
// which kinds of place cause which sounds (the kinds are those of public/data/oau-campus.json, the same list the traffic uses for where people gather)
const COMMERCIAL = new Set(["shop", "town", "social"]), ACADEMIC = new Set(["lecture", "faculty", "library", "admin", "hall", "bank"]), QUIET = new Set(["worship", "hospital", "farm"]);

/**
 * ctx: { x, z, places: [{ x, z, kind }], vehicles: how many vehicles within 80 m, peds: how many walkers within 40 m, onDeck: on the expressway, speed: m/s of the listener, night: boolean }
 * Returns { traffic, crowd, nature, market, hostel, generator, wind, name, hostelAt } (all 0..1 except `name` and `hostelAt`: { x, z } of the nearest hostel, or null).
 */
export function soundWeights(ctx) {
  const { x, z, places = [], vehicles = 0, peds = 0, onDeck = false, speed = 0, night = false } = ctx;
  let com = 0, host = 0, acad = 0, quiet = 0, hostelAt = null, hd = Infinity;
  for (const p of places) {
    const d = Math.hypot(p.x - x, p.z - z); if (d > 130) continue;
    if (COMMERCIAL.has(p.kind)) com = Math.max(com, near(d, 95));
    else if (p.kind === "hostel") { host = Math.max(host, near(d, 80)); if (d < hd) { hd = d; hostelAt = { x: p.x, z: p.z }; } }
    else if (ACADEMIC.has(p.kind)) acad = Math.max(acad, near(d, 70));
    else if (QUIET.has(p.kind)) quiet = Math.max(quiet, near(d, 60));
  }
  const busy = sm(vehicles / 10), peopleHere = sm(peds / 8), deck = onDeck ? 1 : 0;
  const traffic = Math.min(1, 0.22 + 0.5 * busy + 0.7 * deck + 0.3 * com - 0.12 * quiet);
  const crowd = Math.min(1, 0.45 * com + 0.4 * host + 0.2 * acad + 0.4 * peopleHere) * (deck ? 0.1 : 1);
  const market = com * (1 - deck);
  const nature = Math.max(0, (1 - Math.max(com * 0.8, busy * 0.7, deck)) * (0.55 + 0.45 * quiet));
  const generator = host * (night ? 1 : 0.6) * (1 - deck);
  const wind = deck ? Math.min(1, 0.35 + speed / 30) : 0;
  const top = [["highway", deck], ["commercial", com], ["hostel", host], ["road", busy > 0.5 ? busy : 0], ["campus", acad], ["quiet", 0.3]].sort((a, b) => b[1] - a[1])[0][0];
  return { traffic, crowd, nature, market, hostel: host, generator, wind, name: top, hostelAt: host > 0.05 ? hostelAt : null };
}
