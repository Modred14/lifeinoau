// lib/furniture.js
// The furniture catalogue: what a player can buy for their room. Shared by the browser (shop + 3D) and the server (prices, sizes).
// Prices are whole naira. Sizes are in room cells: w is across (x) and d is deep (z) when the item is not rotated; its front faces +z.
// `score` adds to the room score shown on the home screen. `flat` items (rugs) lie on the floor and never block anything.

export const CATEGORIES = [
  { id: "sleep", name: "Sleep", icon: "bed" },
  { id: "study", name: "Study", icon: "study" },
  { id: "kitchen", name: "Kitchen", icon: "kitchen" },
  { id: "comfort", name: "Comfort", icon: "sofa" },
  { id: "fun", name: "Fun", icon: "game" },
  { id: "power", name: "Power", icon: "bolt" },
];

const I = (cat, name, price, w, d, score, blurb, extra = {}) => ({ cat, name, price, w, d, score, blurb, ...extra });

export const ITEMS = {
  // sleep
  iron_bunk: I("sleep", "Iron double bunk", 70_000, 1, 2, 2, "Two sleepers on one iron frame. It creaks, but it is yours."),
  single_bed: I("sleep", "Single bed", 45_000, 1, 2, 4, "A proper bed with a foam mattress."),
  double_bed: I("sleep", "Double bed", 220_000, 2, 2, 8, "Room for two. Rest comes back faster."),
  wardrobe: I("sleep", "Wardrobe", 85_000, 2, 1, 3, "Your clothes finally have a home."),
  nightstand: I("sleep", "Bedside table", 12_000, 1, 1, 1, "A lamp, a phone charger, a glass of water."),
  // fixtures that come with a room (not sold in the shop, never sold back)
  ensuite: I("comfort", "Toilet and shower", 0, 2, 1, 3, "Your own toilet, sink and shower.", { fixed: true }),
  toilet: I("comfort", "Toilet and basin", 0, 2, 1, 1, "The separate toilet, with its own basin.", { fixed: true }),
  dining_set: I("kitchen", "Dining table and chairs", 0, 2, 2, 3, "A table for four, with a plant in the middle.", { fixed: true }),
  // study
  desk: I("study", "Reading desk", 35_000, 2, 1, 2, "Laptop, notes and a mug of garri."),
  plastic_chair: I("study", "Plastic chair", 4_500, 1, 1, 1, "The classic. Every hostel has one."),
  office_chair: I("study", "Office chair", 65_000, 1, 1, 3, "Your back will thank you after exams."),
  bookshelf: I("study", "Bookshelf", 40_000, 1, 1, 2, "Textbooks you will definitely read."),
  gaming_pc: I("study", "Gaming PC desk", 950_000, 2, 1, 10, "Dual monitors and way too many lights."),
  // kitchen
  gas_cooker: I("kitchen", "Gas cooker", 48_000, 1, 1, 2, "Two burners and a gas cylinder."),
  fridge: I("kitchen", "Fridge", 230_000, 1, 1, 5, "Cold water. Cold drinks. Peace."),
  water_dispenser: I("kitchen", "Water dispenser", 75_000, 1, 1, 3, "Hot and cold on demand."),
  counter: I("kitchen", "Kitchenette", 90_000, 2, 1, 3, "A counter, a sink and a microwave."),
  // comfort
  rug: I("comfort", "Ankara rug", 28_000, 2, 2, 2, "Bold pattern, warm feet.", { flat: true }),
  armchair: I("comfort", "Armchair", 110_000, 1, 1, 4, "Sink in and switch off."),
  sofa: I("comfort", "Sofa", 260_000, 2, 1, 6, "Hosts friends, naps and gist."),
  plant: I("comfort", "Snake plant", 8_000, 1, 1, 1, "Hard to kill, nice to look at."),
  mirror: I("comfort", "Standing mirror", 22_000, 1, 1, 1, "Fit check before every lecture."),
  // fun
  tv: I("fun", "TV and stand", 160_000, 2, 1, 5, "Premier League, Nollywood and news."),
  console: I("fun", "Game console", 780_000, 2, 1, 9, "A big screen and two controllers."),
  speakers: I("fun", "Hi-fi speakers", 95_000, 1, 1, 3, "Loud enough for the whole floor."),
  piano: I("fun", "Upright piano", 2_800_000, 2, 1, 12, "Learn something beautiful."),
  pool: I("fun", "Pool table", 1_500_000, 3, 2, 11, "The hostel will queue to play."),
  // power
  fan: I("power", "Standing fan", 18_000, 1, 1, 2, "When NEPA takes light, you still breathe."),
  generator: I("power", "Small generator", 185_000, 1, 1, 4, "I better pass my neighbour. It stands outside, away from the noise and the fumes.", { outdoor: true }),
  inverter: I("power", "Inverter and battery", 650_000, 1, 1, 7, "Silent power. No more fuel queues."),
  ac: I("power", "Standing AC", 420_000, 1, 1, 6, "Cool air, if the light holds."),
};

export const ITEM_KEYS = Object.keys(ITEMS);
export const SELL_PERCENT = 60n; // selling pays 60% of what you paid
export const MAX_ITEMS = 60; // owned items per player
/**
 * What a home comes with, free (these cannot be sold). It depends on the home and on how many people share it:
 *  - a school hostel: iron double bunks (two sleepers each) and one wardrobe, nothing else (no kitchen, no TV, nothing stylish);
 *  - Ojaja: one bedroom with 2 single beds and a wardrobe, a kitchen, a toilet, nepo-style furnishing, no TV;
 *  - off campus: the same as Ojaja but with a TV, and 1 or 2 single beds; the bedroom and the living area are separate rooms there, so the armchair, rug and TV
 *    go in the living area (Ojaja has one room for sleeping and sitting);
 *  - the 1-bedroom flat: a double bed in the bedroom, a living room with a sofa and TV, a kitchen, a bathroom and a separate toilet;
 *  - the 2-bedroom flat: two furnished bedrooms, a living room with a sofa, TV and a dining table, a kitchen, a bathroom and a separate toilet.
 * Every school room, Ojaja and off campus gets exactly ONE wardrobe, however many people share it.
 */
export function starterPlan(hostel, occupants = 2) {
  const times = (n, k) => Array(n).fill(k), at = (zone, ...keys) => keys.map((k) => [k, zone]);
  const kitchen = at("kitchen", "counter", "gas_cooker", "fridge"), bath = at("bath", "ensuite"), toilet = at("toilet", "toilet");
  if (hostel === "Ojaja") return [...at("bed", ...times(2, "single_bed"), "wardrobe", "desk", "office_chair", "rug", "armchair", ...times(2, "nightstand")), ...kitchen, ...bath];
  if (hostel === "Off-campus") return [...at("bed", ...times(occupants, "single_bed"), "wardrobe", "desk", "office_chair", "nightstand"), ...at("living", "tv", "rug", "armchair"), ...kitchen, ...bath];
  if (hostel === "1-Bedroom Flat") return [...at("bed", "double_bed", "wardrobe", ...times(2, "nightstand"), "desk", "office_chair"), ...at("living", "sofa", "tv", "rug", "armchair"), ...kitchen, ...bath, ...toilet];
  if (hostel === "2-Bedroom Flat") return [
    ...at("bed1", "double_bed", "wardrobe", ...times(2, "nightstand")), ...at("bed2", "double_bed", "wardrobe", "nightstand", "desk", "office_chair"),
    ...at("living", "sofa", "tv", "rug", "armchair", "dining_set"), ...kitchen, ...bath, ...toilet];
  return [...times(Math.ceil(occupants / 2), "iron_bunk"), "wardrobe"].map((k) => [k, null]);
}
/** Just the pieces (see starterPlan for where each one goes). */
export const starterFor = (hostel, occupants = 2) => starterPlan(hostel, occupants).map(([k]) => k);

/** Items that stand outside the house (the generator). They are never on the room grid: each takes a spot on the lawn beside the east wall. */
export const isOutdoor = (key) => !!ITEMS[key]?.outdoor;
export const isItem = (key) => Object.prototype.hasOwnProperty.call(ITEMS, key);
export const inShop = (key) => isItem(key) && !ITEMS[key].fixed;
export const priceKobo = (key) => BigInt(ITEMS[key].price) * 100n;
export const sellKobo = (paidKobo) => (BigInt(paidKobo) * SELL_PERCENT) / 100n;
/** Footprint in cells after turning the item `rot` quarter-turns. */
export const sizeOf = (key, rot = 0) => (rot % 2 ? [ITEMS[key].d, ITEMS[key].w] : [ITEMS[key].w, ITEMS[key].d]);
export const roomScore = (items) => items.reduce((n, it) => n + (it.placed ? ITEMS[it.key]?.score ?? 0 : 0), 0);