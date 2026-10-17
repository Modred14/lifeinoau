import { PLACES, type Place } from "../map";

const DELIVERY_KIND_ORDER: readonly Place["kind"][] = ["hostel", "residence"];

/** Places an order can be delivered to: halls and residences first, then everything else by name. */
export const DELIVERY_PLACES: readonly Place[] = [...PLACES].sort((a, b) => {
  const rank = (p: Place) => (DELIVERY_KIND_ORDER.includes(p.kind) ? DELIVERY_KIND_ORDER.indexOf(p.kind) : DELIVERY_KIND_ORDER.length);
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
});

export function findDeliveryPlace(id: unknown): Place | undefined {
  return typeof id === "string" ? PLACES.find((p) => p.id === id) : undefined;
}
