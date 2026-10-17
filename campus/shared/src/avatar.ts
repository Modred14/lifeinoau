/**
 * Avatar customisation catalogue: the single source of truth for what a
 * player can wear. Shared so that:
 *  - the client builds the 3D character and the creator UI from it,
 *  - the server validates every look (unknown ids/colours fall back to defaults),
 *  - the asset pipeline (web/scripts/build-characters.mts) knows which models to ship.
 *
 * A look travels over the network as a short string (see encodeLook), so it
 * costs a few dozen bytes per player, once.
 *
 * Models: Quaternius "Ultimate Modular Men/Women" packs, CC0 (public domain).
 */

export type BodyType = "m" | "f";
export type StudentStyle = "nursing" | "medical" | "lab" | "agric" | "sports" | "formal" | "native" | "dress" | "sneakers" | "hightops" | "loafers" | "sandals" | "slides" | "clogs" | "ankleboots" | "wellies";
export type Hairstyle = "buzz" | "fade" | "afro" | "curls" | "locs" | "cornrows" | "braids" | "ponytail" | "bun";

export interface OutfitDef {
  id: string;
  label: string;
  parts: Record<Slot, string>;
  /** Source model on poly.pizza (CC0), used only by the asset build script. */
  source: string;
  style?: StudentStyle;
  hairstyle?: Hairstyle;
  slots?: readonly Slot[];
}

const studentParts: readonly { id: StudentStyle; label: string; top?: string; bottom?: string; shoes?: string }[] = [
  { id: "nursing", label: "Nursing", top: "Scrub top", bottom: "Scrub trousers" },
  { id: "medical", label: "Medicine", top: "Clinical coat" },
  { id: "lab", label: "Lab practical", top: "Lab coat" },
  { id: "agric", label: "Agriculture", top: "Field shirt & bib", bottom: "Field trousers" },
  { id: "sports", label: "Sports", top: "Sports jersey", bottom: "Sports shorts" },
  { id: "formal", label: "Presentation", top: "Collared shirt", bottom: "Smart trousers" },
  { id: "native", label: "Native wear", top: "Native tunic", bottom: "Native trousers" },
  { id: "sneakers", label: "Sneakers", shoes: "Sneakers" },
  { id: "hightops", label: "High-tops", shoes: "High-tops" },
  { id: "loafers", label: "Loafers", shoes: "Loafers" },
  { id: "sandals", label: "Sandals", shoes: "Sandals" },
  { id: "slides", label: "Slides", shoes: "Slides" },
  { id: "clogs", label: "Clinical clogs", shoes: "Clinical clogs" },
  { id: "ankleboots", label: "Ankle boots", shoes: "Ankle boots" },
  { id: "wellies", label: "Field boots", shoes: "Field boots" },
];

function studentCatalogue(body: BodyType): OutfitDef[] {
  const source = body === "m" ? "90a9e2d4-053f-42f1-99a2-8f5e1180ea7f" : "ba7a1955-ea51-4cb9-a561-188bdef0a6c7";
  const items = [...studentParts];
  if (body === "f") items.push({ id: "dress", label: "Nursing dress", top: "Uniform blouse", bottom: "Uniform skirt" });
  return items.map((item) => ({
    id: item.id, label: item.label, source, style: item.id,
    slots: ["top", "bottom", "shoes"].filter((slot) => !!item[slot as "top" | "bottom" | "shoes"]) as Slot[],
    parts: { head: "", top: item.top ?? "", bottom: item.bottom ?? "", shoes: item.shoes ?? "" },
  }));
}

function hairCatalogue(body: BodyType): OutfitDef[] {
  const styles: readonly [Hairstyle, string][] = body === "m"
    ? [["buzz", "Buzz cut"], ["fade", "Low fade"], ["afro", "Afro"], ["curls", "Short curls"], ["locs", "Short locs"], ["cornrows", "Cornrows"]]
    : [["afro", "Natural afro"], ["curls", "Curly bob"], ["braids", "Box braids"], ["ponytail", "Ponytail"], ["bun", "High bun"], ["locs", "Shoulder locs"]];
  const source = body === "m" ? "90a9e2d4-053f-42f1-99a2-8f5e1180ea7f" : "ba7a1955-ea51-4cb9-a561-188bdef0a6c7";
  return styles.map(([id, label]) => ({ id, label, source, hairstyle: id, slots: ["head"], parts: { head: label, top: "", bottom: "", shoes: "" } }));
}

/**
 * Outfits per body type. Each outfit is split into four swappable parts:
 * head (face + hair/headwear), top, bottom, shoes. Any part can come from
 * any outfit of the same body type.
 */
export const OUTFITS: Record<BodyType, readonly OutfitDef[]> = {
  m: [
    { id: "hoodie", label: "Hoodie", parts: { head: "Messy crop", top: "Hoodie", bottom: "Shorts", shoes: "Trainers" }, source: "bcd66ec5-5e81-4901-a222-47abc875fe2a" },
    { id: "casual", label: "Casual", parts: { head: "Side part", top: "T-shirt", bottom: "Jeans", shoes: "Casual trainers" }, source: "90a9e2d4-053f-42f1-99a2-8f5e1180ea7f" },
    { id: "beach", label: "Casual vest", parts: { head: "Textured crop", top: "Vest", bottom: "Casual shorts", shoes: "Slides" }, source: "f771a536-1c18-4a47-bb56-ceea4b603455" },
    { id: "street", label: "Streetwear", parts: { head: "Mohawk", top: "Zip vest", bottom: "Denim shorts", shoes: "Street shoes" }, source: "e56f23b5-3270-406f-8924-f77cad980c43" },
    ...studentCatalogue("m"),
    ...hairCatalogue("m"),
  ],
  f: [
    { id: "casual", label: "Casual", parts: { head: "Side-part bob", top: "T-shirt", bottom: "Trousers", shoes: "Flats" }, source: "ba7a1955-ea51-4cb9-a561-188bdef0a6c7" },
    { id: "street", label: "Streetwear", parts: { head: "Mohawk", top: "Street top", bottom: "Street bottoms", shoes: "Boots" }, source: "1d368679-1d9a-4d5c-9095-877144b02d00" },
    { id: "owambe", label: "Dinner", parts: { head: "Layered updo", top: "Dinner top", bottom: "Dinner skirt", shoes: "Heels" }, source: "46d6db5a-3c9f-4238-8cdf-8eb7194498dc" },
    ...studentCatalogue("f"),
    ...hairCatalogue("f"),
  ],
};

const RETIRED_OUTFITS: Record<BodyType, Record<string, string>> = {
  m: { corporate: "casual", backpacker: "hoodie", farm: "casual", hivis: "hoodie" },
  f: { corporate: "casual", backpacker: "casual", hivis: "casual" },
};

/** Which source model each body type's animations come from. */
export const ANIMATION_SOURCE: Record<BodyType, string> = {
  m: "bcd66ec5-5e81-4901-a222-47abc875fe2a",
  f: "ba7a1955-ea51-4cb9-a561-188bdef0a6c7",
};

/** Animation clips shipped to the client (names as they appear in the source files). */
export const ANIMATIONS = ["Idle", "Walk", "Run", "Wave", "Interact"] as const;
export type AnimationName = (typeof ANIMATIONS)[number];

export const SLOTS = ["head", "top", "bottom", "shoes"] as const;
export type Slot = (typeof SLOTS)[number];

export function slotOptions(body: BodyType, slot: Slot): readonly OutfitDef[] {
  return OUTFITS[body].filter((outfit) => !outfit.slots || outfit.slots.includes(slot));
}

export const OUTFIT_GROUPS = ["All", "Everyday", "Health sciences", "Practicals", "Sports & events"] as const;
export type OutfitGroup = (typeof OUTFIT_GROUPS)[number];
export interface StudentOutfit {
  id: string;
  label: string;
  group: Exclude<OutfitGroup, "All">;
  looks: Record<BodyType, Pick<Look, "top" | "bottom" | "shoes" | "topColor" | "bottomColor" | "shoesColor">>;
}

const outfitLook = (top: string, bottom: string, shoes: string, topColor: number, bottomColor = topColor, shoesColor = 1) => ({ top, bottom, shoes, topColor, bottomColor, shoesColor });
export const STUDENT_OUTFITS: readonly StudentOutfit[] = [
  { id: "everyday", label: "Lecture day", group: "Everyday", looks: { m: outfitLook("casual", "casual", "sneakers", 0, 3, 0), f: outfitLook("casual", "casual", "sneakers", 0, 3, 0) } },
  { id: "hostel", label: "Hostel day", group: "Everyday", looks: { m: outfitLook("beach", "beach", "slides", 8, 2), f: outfitLook("casual", "casual", "slides", 12, 2) } },
  { id: "street", label: "Campus hangout", group: "Everyday", looks: { m: outfitLook("hoodie", "casual", "hightops", 6, 1, 0), f: outfitLook("street", "street", "hightops", 6, 1, 0) } },
  { id: "nursing", label: "Nursing scrubs", group: "Health sciences", looks: { m: outfitLook("nursing", "nursing", "clogs", 4), f: outfitLook("nursing", "nursing", "clogs", 4) } },
  { id: "uniform", label: "Nursing uniform", group: "Health sciences", looks: { m: outfitLook("nursing", "nursing", "loafers", 0), f: outfitLook("dress", "dress", "loafers", 0) } },
  { id: "medical", label: "Medical student", group: "Health sciences", looks: { m: outfitLook("medical", "formal", "clogs", 0, 3), f: outfitLook("medical", "formal", "clogs", 0, 3) } },
  { id: "lab", label: "Lab practical", group: "Practicals", looks: { m: outfitLook("lab", "casual", "sneakers", 0, 2), f: outfitLook("lab", "casual", "sneakers", 0, 2) } },
  { id: "agric", label: "Agric fieldwork", group: "Practicals", looks: { m: outfitLook("agric", "agric", "wellies", 6, 14), f: outfitLook("agric", "agric", "wellies", 6, 14) } },
  { id: "sports", label: "Sports practice", group: "Sports & events", looks: { m: outfitLook("sports", "sports", "sneakers", 3, 3, 0), f: outfitLook("sports", "sports", "sneakers", 3, 3, 0) } },
  { id: "formal", label: "Presentation day", group: "Sports & events", looks: { m: outfitLook("formal", "formal", "loafers", 0, 1), f: outfitLook("formal", "formal", "loafers", 0, 1) } },
  { id: "native", label: "Native wear", group: "Sports & events", looks: { m: outfitLook("native", "native", "sandals", 15), f: outfitLook("native", "native", "sandals", 15) } },
  { id: "dinner", label: "Dinner night", group: "Sports & events", looks: { m: outfitLook("formal", "formal", "loafers", 11, 1), f: outfitLook("owambe", "owambe", "owambe", 11, 11) } },
];

export function applyStudentOutfit(look: Look, id: string): Look {
  const outfit = STUDENT_OUTFITS.find((item) => item.id === id);
  return outfit ? { ...look, ...outfit.looks[look.body] } : { ...look };
}

/** Skin tones, deepest first. Hex RGB. */
export const SKIN_TONES: readonly number[] = [
  0x3b2219, 0x4a2c20, 0x5c3a28, 0x6f4630, 0x82553a, 0x9a6847, 0xb47c59, 0xd29d7a,
];

export const HAIR_COLORS: readonly number[] = [
  0x0d0b0a, 0x2a1a12, 0x4a2c1a, 0x6b1f2a, 0xb8860b, 0xd9d4cc, 0x7a3cff, 0xd13a6f,
];

export const CLOTH_COLORS: readonly number[] = [
  0xf5f5f0, 0x1c1c1e, 0x8e8e93, 0x1f3a68, 0x2f6fd6, 0x7cc4f2, 0x008751, 0x9bd13b,
  0xf7c948, 0xf28c28, 0xd7263d, 0x7b1e2b, 0xf28ab2, 0x7d4cdb, 0x7a5232, 0xd8c3a5,
];

export interface Look {
  body: BodyType;
  head: string;
  top: string;
  bottom: string;
  shoes: string;
  /** Indexes into SKIN_TONES / HAIR_COLORS / CLOTH_COLORS. */
  skin: number;
  hair: number;
  topColor: number;
  bottomColor: number;
  shoesColor: number;
}

export const DEFAULT_LOOK: Look = {
  body: "m",
  head: "hoodie",
  top: "hoodie",
  bottom: "casual",
  shoes: "hoodie",
  skin: 2,
  hair: 0,
  topColor: 6,
  bottomColor: 3,
  shoesColor: 0,
};

/** Hard cap on the encoded string, checked before parsing untrusted input. */
export const LOOK_MAX_LENGTH = 96;

/** "m|hoodie|hoodie|casual|hoodie|2|0|6|3|0" */
export function encodeLook(l: Look): string {
  return [l.body, l.head, l.top, l.bottom, l.shoes, l.skin, l.hair, l.topColor, l.bottomColor, l.shoesColor].join("|");
}

/**
 * Parse an untrusted look string. Never throws; any invalid field falls back
 * to the default for that field, so a valid Look always comes out.
 */
export function decodeLook(raw: unknown): Look {
  if (typeof raw !== "string" || raw.length > LOOK_MAX_LENGTH) return { ...DEFAULT_LOOK };
  const [body, head, top, bottom, shoes, skin, hair, topColor, bottomColor, shoesColor] = raw.split("|");
  const b: BodyType = body === "f" ? "f" : "m";
  const outfit = (v: string | undefined, slot: Slot) => {
    const options = slotOptions(b, slot);
    const ids = new Set(options.map((o) => o.id));
    if (v && ids.has(v)) return v;
    if (v && Object.hasOwn(RETIRED_OUTFITS[b], v)) return RETIRED_OUTFITS[b][v];
    return options[0].id;
  };
  const index = (v: string | undefined, list: readonly number[], fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < list.length ? n : fallback;
  };
  return {
    body: b,
    head: outfit(head, "head"),
    top: outfit(top, "top"),
    bottom: outfit(bottom, "bottom"),
    shoes: outfit(shoes, "shoes"),
    skin: index(skin, SKIN_TONES, DEFAULT_LOOK.skin),
    hair: index(hair, HAIR_COLORS, DEFAULT_LOOK.hair),
    topColor: index(topColor, CLOTH_COLORS, DEFAULT_LOOK.topColor),
    bottomColor: index(bottomColor, CLOTH_COLORS, DEFAULT_LOOK.bottomColor),
    shoesColor: index(shoesColor, CLOTH_COLORS, DEFAULT_LOOK.shoesColor),
  };
}

/** Normalise an untrusted look string into a canonical one. */
export function sanitizeLook(raw: unknown): string {
  return encodeLook(decodeLook(raw));
}

export function randomLook(rand: () => number = Math.random): Look {
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const body: BodyType = rand() < 0.5 ? "m" : "f";
  const ids = slotOptions(body, "head").map((o) => o.id);
  const idx = (n: number) => Math.floor(rand() * n);
  return applyStudentOutfit({
    body,
    head: pick(ids),
    top: pick(ids),
    bottom: pick(ids),
    shoes: pick(ids),
    skin: idx(6), // bias toward deeper tones
    hair: rand() < 0.75 ? 0 : idx(HAIR_COLORS.length),
    topColor: idx(CLOTH_COLORS.length),
    bottomColor: idx(CLOTH_COLORS.length),
    shoesColor: idx(CLOTH_COLORS.length),
  }, pick(STUDENT_OUTFITS).id);
}

/** Emotes players can trigger (index = wire id). 0 = none. */
export const EMOTES = ["none", "wave", "interact"] as const;
export type EmoteName = (typeof EMOTES)[number];
