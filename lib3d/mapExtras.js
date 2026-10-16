// lib3d/mapExtras.js
// Game places the OpenStreetMap render does not show: Ojaja, Akintola, the Postgraduate hall, Floor O, the three clubs and the ten billboards.
// They are merged onto the real map data when it loads (withExtras), so public/data/oau-campus.json stays exactly as the generator wrote it.
// Positions are GAME PLACEMENTS in the same metre grid as the real data (x east, z south). Each one was checked to sit clear of every
// real building, road, lake and wood on the map, but nobody has surveyed where these places really are, and the map says so (conf "game").
// Billboard prices are real naira, in kobo, and are the single source for the map UI, the API and the tests.

export const BILLBOARD = {
  COUNT: 10,
  SLOTS: 10,               // posters per billboard
  SECONDS: 15,             // each poster shows for this long, then the next one
  SLOT_KOBO: 2_000_000,    // N20,000 for one poster spot
  WHOLE_KOBO: 20_000_000,  // N200,000 for the whole billboard (all 10 spots)
  HOLD_MINUTES: 15,        // a spot stays reserved this long while the buyer pays
  MAX_IMAGE_BYTES: 400_000,
  CAPTION_MAX: 80,
};

/** Billboard positions (metres) and the name of the corner they stand on. */
export const BILLBOARDS = [
  ["Senate Plaza", 292, 40], ["Library Road", 60, -40], ["Law Corner", 90, -312], ["Student Union Strip", -180.4, 156], ["Moremi Junction", -394, -29.6],
  ["Alumni Road", -560, -260], ["Halls Row", -780, 120], ["Fajuyi Crossing", -400, 330], ["Ede Road Banks", 20, 560], ["Nightlife Strip", -183.8, 823.2],
].map(([where, x, z], i) => ({ id: "bb_" + (i + 1), n: i + 1, where, name: `Billboard ${i + 1} · ${where}`, x, z, yaw: 0.7 + (i % 3 - 1) * 0.35 }));

/**
 * Two open grounds the real-map render does not draw, placed in clear space (checked against every building, lake, wood and pitch in the data):
 *  - Motion Ground: the open event field in the gap between the Amphitheatre and the Senate Building.
 *  - Religious Ground: a walled compound just north of the Main Bowl, with four churches. The church names are generic game placements, not surveyed.
 * Rectangles are in the same metre grid as the data (x east, z south).
 */
export const CHURCHES = [
  { id: "church_catholic", name: "Catholic Chapel", x: -43, z: 187, w: 14, d: 20, h: 8, roof: "#8a3b2f", tower: 13 },
  { id: "church_anglican", name: "Anglican Chapel", x: -19, z: 187, w: 14, d: 20, h: 7.5, roof: "#4a5d73", tower: 11 },
  { id: "church_pentecostal", name: "Pentecostal Church", x: -43, z: 218, w: 14, d: 20, h: 8, roof: "#2f5d4a", tower: 10 },
  { id: "church_baptist", name: "Baptist Church", x: -19, z: 218, w: 14, d: 20, h: 7, roof: "#6b4a35", tower: 10 },
];
export const GROUNDS = {
  motion: { id: "motion_ground", name: "Motion Ground", x0: 28, x1: 94, z0: -2, z1: 38 },
  religious: { id: "religious_ground", name: "Religious Ground", x0: -54, x1: -8, z0: 164, z1: 236, gate: -31, churches: CHURCHES },
};

// Buildings made for the places that have no footprint on the real map. w x d metres around the centre, h metres tall.
const BUILDINGS = [
  ...CHURCHES.map((c) => ({ id: c.id, name: c.name, kind: "worship", tier: 3, x: c.x, z: c.z, w: c.w, d: c.d, h: c.h, wall: "#efe9d8", roof: c.roof })),
  { id: "h_ojaja", name: "Ojaja", kind: "hostel", tier: 1, x: -628, z: 1030, w: 60, d: 26, h: 16, shape: "L", wall: "#e9e2d0", roof: "#6b5a46" },
  { id: "h_akintola", name: "Akintola Hall", kind: "hostel", tier: 1, x: 1000, z: -230, w: 52, d: 22, h: 12 },
  { id: "h_pg", name: "Murtala Muhammed Postgraduate Hall", kind: "hostel", tier: 1, x: -740, z: -20, w: 48, d: 20, h: 11 },
  { id: "floor0", name: "Floor O (QRS Custody)", kind: "jail", tier: 1, x: 200, z: 95, w: 30, d: 22, h: 3.5, wall: "#8d99a8", roof: "#b8322f" },
  { id: "club_quantum", name: "Quantum", kind: "club", tier: 1, x: -276.8, z: 873.8, w: 30, d: 20, h: 9, wall: "#5b4a8a", roof: "#2a1d45", neon: "#38e8ff" },
  { id: "club_0203", name: "0203", kind: "club", tier: 1, x: -200, z: 880, w: 30, d: 20, h: 9, wall: "#7a3f6e", roof: "#2a1d45", neon: "#ff4fd8" },
  { id: "club_divas", name: "Royal Divas", kind: "club", tier: 1, x: -100, z: 880, w: 30, d: 20, h: 9, wall: "#8a6a2f", roof: "#2a1d45", neon: "#ffd24a" },
];

/** What a player is told about the places added by this file (the real-map places keep their blurbs in landmarks.js). */
export const EXTRA_META = {
  motion_ground: { blurb: "The open field between the Amphitheatre and the Senate Building. Concerts, rallies, big evenings and the odd football match all end up here.", actions: [{ label: "This week's parties", href: "/parties" }], verified: false },
  religious_ground: { blurb: "A quiet walled ground just before the Main Bowl, with a church for each fellowship. Come for a service, or just for the calm.", actions: [], verified: false },
  ...Object.fromEntries(CHURCHES.map((c) => [c.id, { blurb: `${c.name}, in the Religious Ground before the Main Bowl. Services, choir practice and fellowship.`, actions: [], verified: false }])),
  floor0: { blurb: "Where the QRS takes you when you get caught. You can wait out the time, or pay the bill to walk out early.", actions: [{ label: "Go to Floor O", href: "/play" }], verified: false },
  ...Object.fromEntries(BILLBOARDS.map((b) => [b.id, { blurb: `A billboard at ${b.where}. Ten poster spots, each shown for ${BILLBOARD.SECONDS} seconds in turn.`, actions: [], verified: false }])),
};

const rect = (x, z, w, d) => [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
// An L-shape (two wings) for Ojaja so it reads as a different, pricier kind of building from the plain blocks.
const lShape = (x, z, w, d) => { const a = x - w / 2, b = x + w / 2, c = z - d / 2, e = z + d / 2, t = d * 0.46; return [[a, c], [b, c], [b, c + t], [a + t, c + t], [a + t, e], [a, e]]; };

/**
 * Returns the real map data with the extra places added: new footprints, new places, billboard entries.
 * Pure: the loaded JSON is not changed. Safe to call twice (the second call returns the data untouched).
 */
export function withExtras(data) {
  if (data.extrasAdded) return data;
  const buildings = [...data.buildings], places = [...data.places];
  let next = buildings.reduce((m, q) => Math.max(m, q.id), -1) + 1;
  for (const e of BUILDINGS) {
    if (places.some((p) => p.id === e.id)) continue;
    const pts = (e.shape === "L" ? lShape : rect)(e.x, e.z, e.w, e.d).map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]);
    buildings.push({ id: next, pts, area: Math.round(e.w * e.d * (e.shape === "L" ? 0.75 : 1)), h: e.h, hSrc: "game-placement", wall: e.wall, roof: e.roof, neon: e.neon });
    places.push({ id: e.id, name: e.name, kind: e.kind, tier: e.tier, src: "game-placement", conf: "game", x: e.x, z: e.z, bid: next, snapPx: 0 });
    next++;
  }
  for (const g of Object.values(GROUNDS)) if (!places.some((p) => p.id === g.id)) places.push({ id: g.id, name: g.name, kind: g.id === "motion_ground" ? "sports" : "worship", tier: 2, src: "game-placement", conf: "game", x: +((g.x0 + g.x1) / 2).toFixed(1), z: +((g.z0 + g.z1) / 2).toFixed(1), bid: null, snapPx: 0 });
  for (const b of BILLBOARDS) if (!places.some((p) => p.id === b.id)) places.push({ id: b.id, name: b.name, kind: "billboard", tier: 2, src: "game-placement", conf: "game", x: b.x, z: b.z, bid: null, snapPx: 0, board: b.n, yaw: b.yaw });
  // The map shows one unnamed medical building exactly where the game puts the Health Centre (between Alumni Hall and Awolowo Hall), so it takes that name.
  const mi = places.findIndex((p) => p.id === "medical_unnamed"); if (mi >= 0 && !places.some((p) => p.id === "health_centre")) places[mi] = { ...places[mi], id: "health_centre", name: "Health Centre", unnamed: false, conf: "game" };
  const have = new Set(places.map((p) => p.id));
  return { ...data, grounds: GROUNDS, buildings, places, gameOnly: data.gameOnly.filter((g) => !have.has(g.id)), extrasAdded: true };
}