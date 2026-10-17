// lib3d/interiors/registry.js
// Which places have an inside, and which kind of inside. Pure data, no 3D library, so Node tests can check it.
//
// Rules (see the task brief):
//  - The stable place id is the key. Nothing here looks at a place NAME.
//  - A `kind` alone never earns an interior ("hall" includes the open-air Amphitheatre, "sports" includes the Main Bowl).
//  - Billboards, statues, roads, localities, gates, car parks, farms-as-land, open grounds and fields stay outdoors.
//  - Every entry says WHY, so a reader (or a test) can see the classification was made on purpose.
//
// The layouts themselves are game designs based on what each place is for. No floor plans of the real buildings were available, so nothing
// here claims to be a survey (see PLAN_NOTE).

export const PLAN_NOTE = "A game layout based on what this place is for, not a surveyed floor plan.";

/** Places that must NEVER get an enclosed interior. `why` explains the classification. */
export const OUTDOOR = {
  amphitheatre: { cls: "open-air venue", why: "Open-air venue: tiered seating and a stage under the sky." },
  moremi_statue: { cls: "statue", why: "A statue on a plinth: a standalone object." },
  motion_ground: { cls: "open space", why: "The open event field. Drawn with a stage, stands and floodlights, never walled or roofed." },
  religious_ground: { cls: "open space", why: "A walled open ground. The four churches inside it have their own interiors." },
  main_bowl: { cls: "field", why: "The Main Bowl is an open field, not a building." },
  sports_centre: { cls: "open space", why: "OAU Sports Centre has no known building footprint on the map: kept as open sports ground." },
  basketball: { cls: "outdoor court", why: "An outdoor basketball court." },
  humanities_car_park: { cls: "parking", why: "A car park." },
  gate: { cls: "gate", why: "The Main Gate: a gate structure and security post, not an indoor building." },
  bio_gardens: { cls: "gardens", why: "Gardens are outdoors." },
  zoo: { cls: "outdoor attraction", why: "The zoo is an outdoor attraction." },
  pit_theatre: { cls: "open-air venue", why: "No footprint on the map and described as a theatre 'pit': treated as a sunken open-air performance space, so it stays outdoors." },
  damico: { cls: "locality", why: "A town locality." },
  ede_road: { cls: "road", why: "A road." },
  road1: { cls: "road", why: "A road." },
  mayfair: { cls: "locality", why: "A town locality." },
  asherifa: { cls: "locality", why: "A town locality." },
  sabo: { cls: "locality", why: "A town locality." },
  parakin: { cls: "locality", why: "A town locality." },
  lagere: { cls: "locality", why: "A town locality." },
};
/** Kinds that are always outdoors, whatever the id (catches future billboards, roads, statues, car parks). */
export const OUTDOOR_KINDS = new Set(["billboard", "town", "statue", "gate", "parking"]);

const F = (d, extra) => ({ t: "faculty", d, ...extra });
const T = (size, extra) => ({ t: "theatre", size, ...extra });
const H = (o) => ({ t: "hostel", ...o });
const CH = (v) => ({ t: "church", v });

/** Places with an interior and the plan family that builds it (plans.js). Options give each building its own character. */
export const INTERIOR = {
  // campus core
  oduduwa: { t: "ceremonial" },
  library: { t: "library" },
  senate: { t: "senate" },
  sub: { t: "sub" },
  // faculties and academic buildings
  f_science: F("science"), f_technology: F("engineering"), f_cs: F("computing"), f_law: F("law"),
  f_arts: F("arts1"), f_arts_b2: F("arts2"), f_arts_b3: F("arts3"), f_education: F("education"),
  f_pharmacy: F("pharmacy"), f_pharmacy_new: F("pharmacy_new"), f_health: F("health"), f_social: F("social"),
  f_admin: F("management"), f_edm: F("edm"), dept_architecture: F("architecture"), f_agric: F("agric"),
  geology: F("geology"), cent_sci_lab: F("central_lab"), chem_eng_lab: F("chem_lab"), civil_eng: F("civil"),
  // lecture theatres and teaching blocks
  lt_1000: T("xl"), hslta: T("m"), hsltb: T("m"), hsltc: T("m"), hsltc_n: T("m"), hsltc_s: T("m"), chem_eng_lt: T("m"),
  first_bank_lt: T("m"), computer_auditorium: T("m", { pcs: true }), boob: T("s"), booc: T("s"),
  ctlw: { t: "classrooms" },
  // administration
  white_house: { t: "admin", v: "executive" }, ajose: { t: "admin", v: "offices" }, pg_college: { t: "admin", v: "pg" }, oau_ict: { t: "admin", v: "ict" },
  // other facilities
  museum: { t: "museum" }, staff_school: { t: "school" }, health_centre: { t: "clinic" }, medical_unnamed: { t: "clinic" }, floor0: { t: "custody" },
  squash_court: { t: "squash" },
  cooperative_hall: { t: "multihall", v: "cooperative" }, awovarsity_hall: { t: "multihall", v: "events" }, spider_building: { t: "multihall", v: "spider" },
  etf_mosque: { t: "mosque" },
  church_catholic: CH("catholic"), church_anglican: CH("anglican"), church_pentecostal: CH("pentecostal"), church_baptist: CH("baptist"),
  // banks, shops and food
  ecobank: { t: "bank", v: "green" }, wema_bank: { t: "bank", v: "purple" }, first_bank: { t: "bank", v: "navy" }, zenith_bank: { t: "bank", v: "red" }, access_bank: { t: "bank", v: "orange" },
  school_bookshop: { t: "shop", v: "books" }, as_e_dey: { t: "shop", v: "hotspot" }, dove_phoneworld: { t: "shop", v: "phones" }, new_bukateria: { t: "shop", v: "canteen" },
  afkit: { t: "shop", v: "kiosk" }, buks_empire: { t: "shop", v: "store" }, new_market: { t: "market" },
  // nightlife
  club_quantum: { t: "club", v: "quantum" }, club_0203: { t: "club", v: "0203" }, club_divas: { t: "club", v: "divas" },
  // halls of residence: each one is laid out on its own terms
  h_alumni: H({ v: "undergrad", floors: 2, side: 5, beds: 2, sex: "mixed" }),
  h_awo: H({ v: "undergrad", floors: 2, side: 6, beds: 4, sex: "M" }),
  h_moremi: H({ v: "undergrad", floors: 2, side: 5, beds: 3, sex: "F" }),
  h_fajuyi: H({ v: "undergrad", floors: 2, side: 6, beds: 3, sex: "M" }),
  h_etf: H({ v: "undergrad", floors: 2, side: 5, beds: 4, sex: "mixed" }),
  h_angola: H({ v: "undergrad", floors: 2, side: 5, beds: 2, sex: "M" }),
  h_mozambique: H({ v: "undergrad", floors: 2, side: 6, beds: 4, sex: "M" }),
  h_akintola: H({ v: "undergrad", floors: 2, side: 4, beds: 2, sex: "F" }),
  h_ojaja: H({ v: "premium", floors: 2, side: 4, beds: 1, sex: "mixed" }),
  h_pg: H({ v: "postgrad", floors: 2, side: 5, beds: 1, sex: "mixed" }),
};
// hostel blocks on the map
for (const id of ["blk_1a", "blk_2a", "blk_3a", "blk_5a", "blk_c", "blk_b", "blk_a", "blk_d", "blk_boutary", "blk_f", "blk_g", "blk_h", "blk_i", "blk_j", "blk_5b", "blk_1b", "blk_2b", "blk_3b"]) INTERIOR[id] = { t: "block" };

/** A small stable hash, so every building gets its own (but always the same) variation. */
export const hashId = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * classify(id, kind) -> { mode: "interior" | "outdoor", spec?, cls?, why }
 * An unnamed building on the map ("bld_12") is a real building, so it gets a plain generic inside.
 */
export function classify(id, kind) {
  if (!id) return { mode: "outdoor", cls: "unknown", why: "No place." };
  if (OUTDOOR[id]) return { mode: "outdoor", ...OUTDOOR[id] };
  if (id.startsWith("bb_") || kind === "billboard") return { mode: "outdoor", cls: "billboard", why: "A billboard is a freestanding sign, not a building." };
  if (INTERIOR[id]) return { mode: "interior", spec: { ...INTERIOR[id], id, seed: hashId(id) }, why: "Enclosed building." };
  if (id.startsWith("bld_")) return { mode: "interior", spec: { t: "generic", id, seed: hashId(id) }, why: "Unnamed building on the map: a plain inside." };
  if (OUTDOOR_KINDS.has(kind)) return { mode: "outdoor", cls: kind, why: `${kind} places are outdoors.` };
  // Unknown id: never invent an interior for something we have not looked at.
  return { mode: "outdoor", cls: "unclassified", why: "Not classified as a building yet, so it stays outdoors." };
}

export const hasInterior = (id, kind) => classify(id, kind).mode === "interior";