// lib/wardrobe.js
// Offishall Store: the clothing catalog and the outfit rules. Shared by the browser (shop, wardrobe, 3D preview) and the server (prices, ownership, validation).
//
// WHAT "A WEARABLE ITEM" MEANS HERE. The authored avatar models (public/models/avatars/parts/outfit/<outfit>_<m|f>.glb) are built from separate garment meshes
// (a top, a bottom, shoes). Every catalog item points at one real garment mesh set (a `base`, below) plus a colour from lib/look.js COLORS and a fabric finish.
// Nothing here is only a shop picture: lib3d/avatar/loadAvatar.js builds the character from exactly these fields, so what you buy is what is drawn.
// Honest limit: there are 4 tops and 4-5 bottoms per body, so many items share a silhouette and differ by colour, fabric and (for sets) pairing.
//
// The equipped outfit is `look.wear`: either ONE set id, or ONE top id + ONE bottom id. It lives inside Character.look, so every screen that draws a player
// (map, buildings, hostels, other players, profiles, messages, avatar snapshots) shows it without any further wiring. No `wear` = the starter outfit
// (look.outfit + look.top + look.bottom), which is always a complete outfit.

/** Garment meshes per body: base key -> the outfit model file (without gender suffix) the garment is taken from. */
export const BASES = {
  top: {
    M: { tee: "casual", hoodie: "campus", shirt: "office", tunic: "owambe" },
    F: { tee: "casual", croptop: "campus", blouse: "office", buba: "owambe" },
  },
  bottom: {
    M: { jeans: "casual", chinos: "campus", suit: "office", dress: "owambe", work: "sitework" },
    F: { jeans: "campus", shorts: "casual", pencil: "office", iro: "owambe" },
  },
};

/** Fabric finishes: how the cloth catches the light (roughness / metalness), applied in loadAvatar.js. */
export const FINISHES = {
  cotton: { label: "Cotton", roughness: 0.92, metalness: 0 },
  denim: { label: "Denim", roughness: 0.86, metalness: 0 },
  wool: { label: "Wool", roughness: 0.96, metalness: 0 },
  satin: { label: "Satin", roughness: 0.38, metalness: 0.06 },
  silk: { label: "Silk", roughness: 0.26, metalness: 0.12 },
  leather: { label: "Leather", roughness: 0.42, metalness: 0.04 },
};

export const CATEGORIES = [
  { id: "shirts", label: "Shirts" },
  { id: "trousers", label: "Trousers" },
  { id: "skirts", label: "Skirts" },
  { id: "elite", label: "Elite" },
];
export const STYLES = { casual: "Casual", campus: "Campus", street: "Streetwear", smart: "Smart", heritage: "Heritage", luxury: "Luxury" };
export const MAX_WEAR = 2;

// ---- the catalog ----
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const ITEMS = [];
/** One single garment. g: "M", "F" or "U" (unisex: the base exists on both bodies). */
function one(cat, tier, style, g, slot, base, color, finish, naira, name) {
  const parts = { [slot]: { base, color, finish } };
  ITEMS.push({ id: `${slot === "top" ? "t" : "b"}_${slug(name)}`, name, category: cat, tier, style, g, slot, parts, priceNaira: naira });
}
/** A complete outfit: a coordinated top and bottom sold together. */
function set(style, g, top, bottom, name, naira) {
  ITEMS.push({ id: `s_${slug(name)}`, name, category: "elite", tier: "elite", style, g, slot: "set", parts: { top: { ...top }, bottom: { ...bottom } }, priceNaira: naira });
}
const T = (base, color, finish = "cotton") => ({ base, color, finish });
const shirt = (...a) => one("shirts", "standard", ...a.slice(0, 1), a[1], "top", ...a.slice(2));
const trouser = (...a) => one("trousers", "standard", ...a.slice(0, 1), a[1], "bottom", ...a.slice(2));
const skirt = (...a) => one("skirts", "standard", ...a.slice(0, 1), "F", "bottom", ...a.slice(1));
const eliteTop = (style, g, base, color, finish, naira, name) => one("elite", "elite", style, g, "top", base, color, finish, naira, name);
const eliteBottom = (style, g, base, color, finish, naira, name) => one("elite", "elite", style, g, "bottom", base, color, finish, naira, name);

// Shirts, N12,000 - N25,000
shirt("campus", "U", "tee", "white", "cotton", 12000, "Faculty Tee");
shirt("casual", "U", "tee", "black", "cotton", 12500, "Midnight Library Tee");
shirt("casual", "U", "tee", "grey", "cotton", 13000, "Harmattan Grey Tee");
shirt("campus", "U", "tee", "sky", "cotton", 13500, "Ife Sky Tee");
shirt("casual", "U", "tee", "maroon", "cotton", 14000, "Moremi Maroon Tee");
shirt("casual", "U", "tee", "olive", "cotton", 14500, "Sunday Olive Tee");
shirt("casual", "U", "tee", "cream", "cotton", 15000, "Cream Linen Tee");
shirt("campus", "M", "hoodie", "navy", "cotton", 22000, "Unity Hoodie");
shirt("street", "M", "hoodie", "charcoal", "cotton", 23000, "Ajose Grey Hoodie");
shirt("street", "M", "hoodie", "orange", "cotton", 24000, "Blaze Orange Hoodie");
shirt("street", "M", "hoodie", "teal", "cotton", 24500, "Teal Drip Hoodie");
shirt("campus", "M", "hoodie", "green", "cotton", 22500, "Forest Pullover Hoodie");
shirt("street", "M", "hoodie", "maroon", "cotton", 25000, "Oxblood Hoodie");
shirt("campus", "F", "croptop", "white", "cotton", 15000, "Pearl Crop Top");
shirt("campus", "F", "croptop", "pink", "cotton", 16000, "Rose Quartz Crop");
shirt("casual", "F", "croptop", "teal", "cotton", 16500, "Lagoon Crop");
shirt("street", "F", "croptop", "black", "cotton", 17000, "Noir Crop");
shirt("street", "F", "croptop", "orange", "cotton", 17500, "Sunset Crop");
shirt("casual", "F", "croptop", "purple", "cotton", 18000, "Lilac Crop");
shirt("smart", "M", "shirt", "white", "cotton", 20000, "Boardroom Oxford Shirt");
shirt("smart", "M", "shirt", "sky", "cotton", 21000, "Sky Poplin Shirt");
shirt("smart", "M", "shirt", "navy", "cotton", 22000, "Navy Dress Shirt");
shirt("smart", "M", "shirt", "charcoal", "cotton", 23000, "Charcoal Slim Shirt");
shirt("smart", "M", "shirt", "pink", "cotton", 24000, "Blush Business Shirt");
shirt("smart", "F", "blouse", "white", "satin", 20000, "Pearl Satin Blouse");
shirt("smart", "F", "blouse", "navy", "satin", 21000, "Navy Bow Blouse");
shirt("smart", "F", "blouse", "maroon", "satin", 22500, "Burgundy Blouse");
shirt("smart", "F", "blouse", "green", "satin", 23500, "Emerald Blouse");
shirt("smart", "F", "blouse", "cream", "satin", 25000, "Champagne Blouse");
shirt("heritage", "M", "tunic", "cream", "cotton", 24000, "Ile-Ife Kaftan");
shirt("heritage", "M", "tunic", "blue", "cotton", 25000, "Royal Blue Kaftan");
shirt("heritage", "F", "buba", "orange", "cotton", 24000, "Iya Oge Buba");
shirt("heritage", "F", "buba", "teal", "cotton", 25000, "Adire Teal Buba");

// Trousers, N18,000 - N30,000
trouser("casual", "U", "jeans", "blue", "denim", 18000, "Classic Indigo Jeans");
trouser("street", "U", "jeans", "black", "denim", 19500, "Black Skinny Jeans");
trouser("casual", "U", "jeans", "grey", "denim", 20000, "Grey Wash Jeans");
trouser("campus", "U", "jeans", "sky", "denim", 20500, "Sky Wash Jeans");
trouser("street", "U", "jeans", "charcoal", "denim", 21500, "Charcoal Straight Jeans");
trouser("casual", "U", "jeans", "navy", "denim", 22500, "Navy Rinse Jeans");
trouser("casual", "U", "jeans", "khaki", "denim", 23000, "Sand Denim Jeans");
trouser("campus", "M", "chinos", "khaki", "cotton", 18500, "Campus Khaki Chinos");
trouser("campus", "M", "chinos", "olive", "cotton", 19500, "Olive Utility Chinos");
trouser("campus", "M", "chinos", "navy", "cotton", 20500, "Navy Chinos");
trouser("casual", "M", "chinos", "cream", "cotton", 21000, "Stone Chinos");
trouser("casual", "M", "chinos", "maroon", "cotton", 22000, "Wine Chinos");
trouser("street", "M", "chinos", "black", "cotton", 23500, "Shadow Chinos");
trouser("smart", "M", "suit", "black", "wool", 26000, "Executive Black Trousers");
trouser("smart", "M", "suit", "charcoal", "wool", 27500, "Charcoal Tailored Trousers");
trouser("smart", "M", "suit", "navy", "wool", 28500, "Navy Tailored Trousers");
trouser("smart", "M", "suit", "grey", "wool", 30000, "Grey Flannel Trousers");
trouser("heritage", "M", "dress", "cream", "satin", 24000, "Ceremony Trousers");
trouser("heritage", "M", "dress", "blue", "satin", 26000, "Royal Ceremony Trousers");
trouser("campus", "M", "work", "khaki", "cotton", 18000, "Site Cargo Trousers");
trouser("campus", "M", "work", "olive", "cotton", 21000, "Foreman Trousers");
trouser("casual", "F", "shorts", "blue", "denim", 18000, "Denim Cut-offs");
trouser("street", "F", "shorts", "black", "denim", 19000, "Black Denim Shorts");
trouser("casual", "F", "shorts", "khaki", "cotton", 20000, "Sand Shorts");
trouser("casual", "F", "shorts", "pink", "cotton", 21000, "Peony Shorts");
trouser("campus", "F", "shorts", "sky", "denim", 22000, "Lagoon Shorts");

// Skirts (women), N15,000 - N28,000
skirt("smart", "pencil", "black", "wool", 15000, "Secretary Pencil Skirt");
skirt("smart", "pencil", "navy", "wool", 16500, "Navy Pencil Skirt");
skirt("smart", "pencil", "charcoal", "wool", 17500, "Charcoal Pencil Skirt");
skirt("smart", "pencil", "maroon", "wool", 19000, "Burgundy Pencil Skirt");
skirt("smart", "pencil", "khaki", "cotton", 20500, "Camel Pencil Skirt");
skirt("smart", "pencil", "cream", "cotton", 22000, "Ivory Pencil Skirt");
skirt("smart", "pencil", "pink", "satin", 23500, "Rose Satin Skirt");
skirt("heritage", "iro", "navy", "cotton", 24000, "Indigo Iro Wrapper");
skirt("heritage", "iro", "blue", "cotton", 25000, "Adire Iro Wrapper");
skirt("heritage", "iro", "orange", "cotton", 26000, "Ankara Sun Iro");
skirt("heritage", "iro", "purple", "satin", 27500, "Aso-Oke Plum Iro");
skirt("heritage", "iro", "green", "satin", 28000, "Emerald Iro Wrapper");

// Elite Collection: designer-style pieces
eliteTop("luxury", "M", "shirt", "white", "silk", 95000, "Atelier Silk Shirt");
eliteTop("luxury", "M", "shirt", "black", "silk", 110000, "Maison Noir Shirt");
eliteTop("luxury", "M", "shirt", "navy", "satin", 125000, "Verona Satin Shirt");
eliteTop("luxury", "M", "tunic", "purple", "silk", 150000, "Lagos Royale Kaftan");
eliteTop("luxury", "M", "tunic", "maroon", "silk", 180000, "Oba Aso-Oke Kaftan");
eliteTop("luxury", "M", "hoodie", "black", "satin", 98000, "Phantom Satin Hoodie");
eliteTop("luxury", "M", "hoodie", "yellow", "leather", 135000, "Gold Label Hoodie");
eliteTop("luxury", "F", "blouse", "cream", "silk", 105000, "Couture Champagne Blouse");
eliteTop("luxury", "F", "blouse", "navy", "silk", 120000, "Midnight Satin Blouse");
eliteTop("luxury", "F", "buba", "yellow", "silk", 160000, "Empress Gold Buba");
eliteTop("luxury", "F", "buba", "purple", "silk", 185000, "Aso-Oke Royal Buba");
eliteTop("luxury", "F", "croptop", "black", "leather", 90000, "Onyx Leather Crop");
eliteTop("luxury", "F", "croptop", "red", "satin", 112000, "Ruby Satin Crop");
eliteBottom("luxury", "M", "suit", "black", "silk", 120000, "Savile Tailored Trousers");
eliteBottom("luxury", "M", "suit", "cream", "wool", 130000, "Monaco Linen Trousers");
eliteBottom("luxury", "M", "suit", "navy", "silk", 140000, "Chairman Trousers");
eliteBottom("luxury", "M", "chinos", "brown", "wool", 95000, "Heritage Cocoa Chinos");
eliteBottom("luxury", "U", "jeans", "black", "leather", 100000, "Raw Obsidian Jeans");
eliteBottom("luxury", "U", "jeans", "brown", "denim", 115000, "Gold Stitch Denim");
eliteBottom("luxury", "F", "pencil", "black", "silk", 100000, "Parisian Noir Pencil Skirt");
eliteBottom("luxury", "F", "pencil", "cream", "satin", 115000, "Champagne Satin Pencil Skirt");
eliteBottom("luxury", "F", "pencil", "red", "silk", 125000, "Ruby Silk Pencil Skirt");
eliteBottom("luxury", "F", "iro", "purple", "silk", 170000, "Aso-Oke Royal Iro");
eliteBottom("luxury", "F", "iro", "yellow", "silk", 190000, "Gold Thread Iro");
// Complete outfits (a top and a bottom sold together)
set("luxury", "M", T("shirt", "navy", "satin"), T("suit", "black", "wool"), "Executive Suit Midnight", 380000);
set("luxury", "M", T("shirt", "white", "silk"), T("suit", "charcoal", "wool"), "Chairman Suit Charcoal", 450000);
set("luxury", "M", T("tunic", "maroon", "silk"), T("dress", "cream", "silk"), "Oba Court Regalia", 620000);
set("luxury", "M", T("tunic", "cream", "satin"), T("dress", "blue", "satin"), "Sunday Best Kaftan Set", 340000);
set("luxury", "M", T("hoodie", "black", "satin"), T("jeans", "black", "leather"), "Void Streetwear Capsule", 290000);
set("luxury", "M", T("tee", "white", "silk"), T("chinos", "cream", "cotton"), "Riviera Weekend Set", 260000);
set("luxury", "F", T("blouse", "white", "silk"), T("pencil", "black", "wool"), "Boardroom Power Set", 360000);
set("luxury", "F", T("blouse", "black", "silk"), T("pencil", "black", "silk"), "Gala Noir Set", 420000);
set("luxury", "F", T("buba", "yellow", "silk"), T("iro", "yellow", "silk"), "Iya Oge Gold Set", 600000);
set("luxury", "F", T("buba", "purple", "silk"), T("iro", "purple", "silk"), "Aso-Oke Royal Set", 650000);
set("luxury", "F", T("croptop", "black", "leather"), T("jeans", "black", "denim"), "Street Luxe Set", 280000);
set("luxury", "F", T("tee", "cream", "silk"), T("shorts", "khaki", "cotton"), "Weekend Resort Set", 250000);

export const CATALOG = Object.freeze(ITEMS.map((i) => Object.freeze(i)));
const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));
export const itemById = (id) => (typeof id === "string" ? BY_ID.get(id) ?? null : null);

/** Does the item exist on this body? Every garment base must be available for the gender, and a gendered item is only for that gender. */
export function fitsGender(item, gender) {
  const g = gender === "F" ? "F" : "M";
  if (!item || (item.g !== "U" && item.g !== g)) return false;
  return Object.entries(item.parts).every(([slot, p]) => !!BASES[slot][g][p.base]);
}
export const forGender = (gender) => CATALOG.filter((i) => fitsGender(i, gender));
export const priceKobo = (item) => BigInt(item.priceNaira) * 100n;

/** Check an equipped outfit. ids = one set, or one top and one bottom. Never accepts half an outfit.
 *  Returns { ok: true, ids, parts: { top, bottom } } (each part: { base, color, finish, src: outfit model name }) or { ok: false, reason }. */
export function checkWear(ids, gender) {
  const g = gender === "F" ? "F" : "M";
  if (!Array.isArray(ids) || !ids.length) return { ok: false, reason: "Choose what to wear." };
  const list = [...new Set(ids)];
  if (list.length > MAX_WEAR) return { ok: false, reason: "An outfit is one set, or one top and one bottom." };
  const items = list.map(itemById);
  if (items.some((i) => !i)) return { ok: false, reason: "That item is not in the store." };
  if (items.some((i) => !fitsGender(i, g))) return { ok: false, reason: "That item is not made for your character's body type." };
  let top = null, bottom = null;
  if (items.some((i) => i.slot === "set")) {
    if (items.length !== 1) return { ok: false, reason: "A complete outfit is worn on its own." };
    ({ top, bottom } = items[0].parts);
  } else {
    const tops = items.filter((i) => i.slot === "top"), bottoms = items.filter((i) => i.slot === "bottom");
    if (tops.length > 1 || bottoms.length > 1) return { ok: false, reason: "Wear one top and one bottom." };
    if (!tops.length) return { ok: false, reason: "Add a shirt or top: trousers and skirts cannot be worn on their own." };
    if (!bottoms.length) return { ok: false, reason: "Add trousers or a skirt: a shirt cannot be worn on its own." };
    top = tops[0].parts.top; bottom = bottoms[0].parts.bottom;
  }
  const src = (slot, p) => ({ ...p, src: BASES[slot][g][p.base] });
  return { ok: true, ids: list, parts: { top: src("top", top), bottom: src("bottom", bottom) } };
}

/** The ids of a look's outfit if it is a valid complete one for this gender, otherwise null (the starter outfit is drawn). Used by cleanLook. */
export function cleanWear(wear, gender) {
  const r = checkWear(wear, gender);
  return r.ok ? r.ids : null;
}
/** What the outfit looks like as the older look fields (used by the built-in character when a model file is missing). */
export function legacyFields(wear, gender) {
  const r = checkWear(wear, gender);
  return r.ok ? { outfit: r.parts.bottom.src, top: r.parts.top.color, bottom: r.parts.bottom.color } : null;
}
/** The pieces of the outfit being worn, in a stable order, for equality checks. */
export const wearKey = (wear) => (Array.isArray(wear) ? [...wear].sort().join("+") : "");

/** The best complete outfit that includes `item`, made only from what is owned: a set alone, otherwise the item plus the matching piece already worn
 *  (or any owned one). Returns ids, or null when something is missing (then the player is told what to add). */
export function outfitWith(item, ownedIds, currentWear, gender) {
  if (!item || !fitsGender(item, gender)) return null;
  const owned = new Set(ownedIds);
  if (item.slot === "set") return [item.id];
  const need = item.slot === "top" ? "bottom" : "top";
  const usable = (id) => owned.has(id) && fitsGender(itemById(id), gender) && itemById(id).slot === need;
  const partner = (currentWear ?? []).find(usable) ?? [...owned].find(usable);
  return partner ? (item.slot === "top" ? [item.id, partner] : [partner, item.id]) : null;
}

/** Stand-ins used only to PREVIEW an unowned item with something sensible underneath or on top (never worn, never sold as part of the preview). */
const PREVIEW_PARTNER = { top: { M: "t_faculty_tee", F: "t_pearl_crop_top" }, bottom: { M: "b_campus_khaki_chinos", F: "b_classic_indigo_jeans" } };
/** The outfit to show on the 3D preview for an item: its own set, or the item with the matching piece from what is worn / owned / a plain stand-in. */
export function previewWith(item, ownedIds, currentWear, gender) {
  const g = gender === "F" ? "F" : "M";
  const own = outfitWith(item, ownedIds, currentWear, g);
  if (own) return own;
  const need = item.slot === "top" ? "bottom" : "top", p = PREVIEW_PARTNER[need][g];
  return item.slot === "top" ? [item.id, p] : [p, item.id];
}
