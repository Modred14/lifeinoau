export const ORDER_REQUEST_MAX = 500;
export const ORDER_NOTE_MAX = 120;
export const ORDER_CANCEL_REASON_MAX = 200;
export const ORDER_ITEM_COST_MAX_KOBO = 200_000 * 100;
export const KOBO_PER_NAIRA = 100;

export const OrderStatus = {
  Placed: "placed",
  Claimed: "claimed",
  PickedUp: "picked_up",
  Delivered: "delivered",
  Cancelled: "cancelled",
} as const;
export type OrderStatusCode = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OPEN_ORDER_STATUSES: readonly OrderStatusCode[] = [OrderStatus.Placed, OrderStatus.Claimed, OrderStatus.PickedUp];

export const ORDER_STATUS_LABEL: Record<OrderStatusCode, string> = {
  placed: "Waiting for a rider",
  claimed: "Rider on the way to the shop",
  picked_up: "Rider on the way to you",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const PaymentMethod = { OnDelivery: "pay_on_delivery" } as const;
export type PaymentMethodCode = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const StaffRole = { Rider: "rider", Admin: "admin" } as const;
export type StaffRoleCode = (typeof StaffRole)[keyof typeof StaffRole];
export const STAFF_ROLES: readonly StaffRoleCode[] = [StaffRole.Rider, StaffRole.Admin];

export const MarketError = {
  Invalid: "invalid",
  SignedOut: "signed_out",
  Forbidden: "forbidden",
  NotFound: "not_found",
  Conflict: "conflict",
  NotDeliverable: "not_deliverable",
  TooManyOpen: "too_many_open",
  TooManyRequests: "too_many_requests",
  Unavailable: "unavailable",
} as const;
export type MarketErrorCode = (typeof MarketError)[keyof typeof MarketError];

export interface MarketOrderView {
  id: string;
  code: string;
  vendorId: string;
  vendorName: string;
  vendorArea: string;
  request: string;
  deliverTo: string;
  deliverToName: string;
  deliverNote: string;
  status: OrderStatusCode;
  paymentMethod: PaymentMethodCode;
  itemCostKobo: number | null;
  deliveryFeeKobo: number;
  totalKobo: number | null;
  riderName: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiderOrderView extends MarketOrderView {
  customerName: string;
  /** Only shown to the rider who claimed the order. */
  contactPhone: string | null;
  mine: boolean;
}

export interface MarketSummary {
  deliveryFeeKobo: number;
  orders: MarketOrderView[];
  roles: StaffRoleCode[];
}

export interface RiderQueue {
  open: RiderOrderView[];
  mine: RiderOrderView[];
}

export interface PlaceOrderInput {
  requestId: string;
  vendorId: string;
  request: string;
  deliverTo: string;
  deliverNote: string;
  contactPhone: string;
}

export const ORDER_CODE_LENGTH = 6;

/** Short code riders and students read out to each other. */
export function orderCode(id: string): string {
  return id.slice(-ORDER_CODE_LENGTH).toUpperCase();
}

/** Nigerian mobile numbers in +234 form, or null when the number is not one. */
export function normalizeNigerianPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s\-().]/g, "");
  const match = /^(?:\+?234|0)([789][01]\d{8})$/.exec(digits);
  return match ? `+234${match[1]}` : null;
}

export function formatNaira(kobo: number): string {
  return `₦${(kobo / KOBO_PER_NAIRA).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}
