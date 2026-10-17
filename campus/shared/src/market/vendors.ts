import { MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, type Point } from "../map";
import { latLngToMap } from "../geo";
import vendorData from "../data/vendors.json";

export type VendorCategory = "food" | "provisions" | "books" | "cyber";

export const VENDOR_CATEGORIES: readonly VendorCategory[] = ["food", "provisions", "books", "cyber"];

export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  food: "Food",
  provisions: "Provisions",
  books: "Books",
  cyber: "Cyber cafes",
};

const EDGE_SNAP_M = 50;

interface VendorRecord {
  id: string;
  name: string;
  category: string;
  area: string;
  lat?: number;
  lng?: number;
  place?: string;
  delivers: boolean;
  about?: string;
  hours?: string;
  source: string;
}

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  area: string;
  delivers: boolean;
  about?: string;
  hours?: string;
  source: string;
  /** Where the vendor sits on the game map, or null when it is off the map or its spot is unknown. */
  point: Point | null;
  /** True when the point is the named building or area rather than the shop itself. */
  approximate: boolean;
}

export const VENDORS_CHECKED_ON: string = vendorData.checked;

function isCategory(value: string): value is VendorCategory {
  return (VENDOR_CATEGORIES as readonly string[]).includes(value);
}

function onMap(p: Point): Point | null {
  const margin = EDGE_SNAP_M * PX_PER_METER;
  if (p.x < -margin || p.y < -margin || p.x > MAP_WIDTH_PX + margin || p.y > MAP_HEIGHT_PX + margin) return null;
  return { x: Math.min(MAP_WIDTH_PX, Math.max(0, p.x)), y: Math.min(MAP_HEIGHT_PX, Math.max(0, p.y)) };
}

function toVendor(record: VendorRecord): Vendor {
  if (!isCategory(record.category)) throw new Error(`Unknown vendor category ${record.category} for ${record.id}`);
  let point: Point | null = null;
  let approximate = false;
  if (record.lat !== undefined && record.lng !== undefined) {
    point = onMap(latLngToMap(record.lat, record.lng));
  } else if (record.place) {
    const place = PLACES.find((p) => p.name === record.place);
    if (!place) throw new Error(`Vendor ${record.id} names an unknown place ${record.place}`);
    point = place.door;
    approximate = true;
  }
  const { lat: _lat, lng: _lng, place: _place, category, ...rest } = record;
  return { ...rest, category, point, approximate };
}

export const VENDORS: readonly Vendor[] = (vendorData.vendors as VendorRecord[]).map(toVendor);

export function findVendor(id: unknown): Vendor | undefined {
  return typeof id === "string" ? VENDORS.find((v) => v.id === id) : undefined;
}

/** Metres from a map point to the vendor, or null when the vendor has no spot on the map. */
export function vendorDistanceM(vendor: Vendor, from: Point | undefined): number | null {
  if (!vendor.point || !from) return null;
  return Math.hypot(vendor.point.x - from.x, vendor.point.y - from.y) / PX_PER_METER;
}

/** Vendors closest first; ones without a spot go last, in list order. */
export function vendorsByDistance(from: Point | undefined, category?: VendorCategory): Vendor[] {
  const list = VENDORS.filter((v) => !category || v.category === category);
  return list
    .map((vendor, index) => ({ vendor, index, d: vendorDistanceM(vendor, from) }))
    .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || a.index - b.index)
    .map((row) => row.vendor);
}
