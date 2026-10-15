// lib/bet/fixtures.js
// The fake football listing. PURE and PUBLIC: the browser and the server both build the same fixtures from the clock alone,
// so the listing opens instantly with no request. Only the RESULTS are secret (see results.js, server only).
//
// Every CYCLE_MS a new round of matches kicks off. A match lasts MATCH_MS of real time (90 game minutes), then it is full time.
export const EPOCH = Date.UTC(2026, 0, 1);
export const CYCLE_MS = 5 * 60_000; // a new round every 5 minutes
export const MATCH_MS = 180_000; // 90 game minutes in 3 real minutes: one game minute = 2 seconds
export const HORIZON = 6; // rounds you can bet on ahead of time (30 minutes)
export const CLOSE_MS = 3_000; // betting closes this long before kickoff

export const LEAGUES = [
  { id: "hl", name: "Harmattan League", short: "HL" },
  { id: "sc", name: "Savanna Cup", short: "SC" },
];
// invented clubs and a hidden strength (40 to 90): strong sides are short odds, weak sides are long shots
const TEAMS = {
  hl: [["Northgate United", 84], ["Riverbend City", 78], ["Palmwine Athletic", 66], ["Harmattan Rovers", 71], ["Iroko Wanderers", 58], ["Baobab FC", 62],
    ["Cocoa Coast", 74], ["Laterite United", 52], ["Ember City", 69], ["Mango Town", 47], ["Kola Albion", 56], ["Zuma Dynamo", 63]],
  sc: [["Savanna Lions", 82], ["Delta Mariners", 76], ["Sunset Strikers", 68], ["Cedar Park Rangers", 60], ["Tamarind Town", 72], ["Kora Athletic", 55],
    ["Obsidian FC", 80], ["Calabash United", 49], ["Plateau Wanderers", 64], ["Lagoon City", 70], ["Granite Albion", 44], ["Bamboo Rovers", 58]],
};

/** Small seeded random numbers (mulberry32) so a given round always produces the same fixtures. */
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const roundOf = (t) => Math.floor((t - EPOCH) / CYCLE_MS);
export const kickoffOf = (round) => EPOCH + round * CYCLE_MS;

/** Expected goals for each side from the two strengths (home advantage built in). */
export function expectedGoals(rh, ra) {
  const d = (rh - ra) / 100;
  return [1.38 * Math.exp(1.15 * d), 1.08 * Math.exp(-1.15 * d)];
}

const cache = new Map();
/** The eight matches of one round (four per league). */
export function fixturesOf(round) {
  if (cache.has(round)) return cache.get(round);
  const out = [];
  LEAGUES.forEach((L, li) => {
    const rnd = seeded(`fx|${L.id}|${round}`);
    const pool = TEAMS[L.id].map((t, i) => ({ t, k: rnd(), i })).sort((a, b) => a.k - b.k).map((x) => x.t);
    for (let m = 0; m < 4; m++) {
      const [home, hr] = pool[m * 2], [away, ar] = pool[m * 2 + 1];
      const form = (rnd() - 0.5) * 12, // a little match-to-match noise so repeat fixtures do not carry identical odds
        [lh, la] = expectedGoals(hr + form, ar - form * 0.5);
      out.push({ id: `${round}-${li * 4 + m}`, round, league: L.id, leagueName: L.name, home, away, ko: kickoffOf(round), lh, la });
    }
  });
  if (cache.size > 200) cache.clear();
  cache.set(round, out);
  return out;
}

export function parseId(id) {
  const m = /^(\d{1,7})-([0-7])$/.exec(String(id ?? ""));
  return m ? fixturesOf(Number(m[1]))[Number(m[2])] : null;
}

/** minute 0..90 for a kickoff and a time; null before kickoff. */
export const minuteAt = (ko, now) => (now < ko ? null : Math.min(90, Math.floor((now - ko) / (MATCH_MS / 90))));
export const phaseAt = (ko, now) => (now < ko ? "pre" : now < ko + MATCH_MS ? "live" : "ft");
export const isOpen = (fx, now) => now < fx.ko - CLOSE_MS;
/** Rounds worth showing now: the one in progress (live or just ended) and the ones ahead. */
export const listRounds = (now) => {
  const cur = roundOf(now), r = [];
  for (let k = cur; k <= cur + HORIZON; k++) r.push(k);
  return r;
};