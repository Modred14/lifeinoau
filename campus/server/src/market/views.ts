import { findDeliveryPlace, findVendor, orderCode, type MarketOrderView, type RiderOrderView } from "@campuslife/shared/market";
import type { MarketOrderRow } from "../database/schema";

export function orderView(row: MarketOrderRow, riderName: string | null): MarketOrderView {
  const vendor = findVendor(row.vendorId);
  return {
    id: row.id,
    code: orderCode(row.id),
    vendorId: row.vendorId,
    vendorName: vendor?.name ?? row.vendorId,
    vendorArea: vendor?.area ?? "",
    request: row.request,
    deliverTo: row.deliverTo,
    deliverToName: findDeliveryPlace(row.deliverTo)?.name ?? row.deliverTo,
    deliverNote: row.deliverNote,
    status: row.status,
    paymentMethod: row.paymentMethod,
    itemCostKobo: row.itemCostKobo,
    deliveryFeeKobo: row.deliveryFeeKobo,
    totalKobo: row.itemCostKobo === null ? null : row.itemCostKobo + row.deliveryFeeKobo,
    riderName,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function riderOrderView(row: MarketOrderRow, names: { customer: string; rider: string | null }, viewerId: string): RiderOrderView {
  const mine = row.riderAccountId === viewerId;
  return { ...orderView(row, names.rider), customerName: names.customer, contactPhone: mine ? row.contactPhone : null, mine };
}
