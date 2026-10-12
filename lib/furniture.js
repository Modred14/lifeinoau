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
  single_bed: I("sleep", "Single bed", 45_000, 1, 2, 4, "A proper bed with a foam mattress."),
  double_bed: I("sleep", "Double bed", 220_000, 2, 2, 8, "Room for two. Rest comes back faster."),
  wardrobe: I("sleep", "Wardrobe", 85_000, 2, 1, 3, "Your clothes finally have a home."),
  nightstand: I("sleep", "Bedside table", 12_000, 1, 1, 1, "A lamp, a phone charger, a glass of water."),
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
  generator: I("power", "Small generator", 185_000, 1, 1, 4, "I better pass my neighbour."),
  inverter: I("power", "Inverter and battery", 650_000, 1, 1, 7, "Silent power. No more fuel queues."),
  ac: I("power", "Standing AC", 420_000, 1, 1, 6, "Cool air, if the light holds."),
};

export const ITEM_KEYS = Object.keys(ITEMS);
export const SELL_PERCENT = 60n; // selling pays 60% of what you paid
export const MAX_ITEMS = 60; // owned items per player
/** Everyone moves in with these, free. They cannot be sold. */
export const STARTER = ["single_bed", "wardrobe", "desk", "plastic_chair"];

export const isItem = (key) => Object.prototype.hasOwnProperty.call(ITEMS, key);
export const priceKobo = (key) => BigInt(ITEMS[key].price) * 100n;
export const sellKobo = (paidKobo) => (BigInt(paidKobo) * SELL_PERCENT) / 100n;
/** Footprint in cells after turning the item `rot` quarter-turns. */
export const sizeOf = (key, rot = 0) => (rot % 2 ? [ITEMS[key].d, ITEMS[key].w] : [ITEMS[key].w, ITEMS[key].d]);
export const roomScore = (items) => items.reduce((n, it) => n + (it.placed ? ITEMS[it.key]?.score ?? 0 : 0), 0);