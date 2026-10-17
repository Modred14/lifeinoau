import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import {
  MarketError,
  OPEN_ORDER_STATUSES,
  ORDER_NOTE_MAX,
  ORDER_REQUEST_MAX,
  OrderStatus,
  findDeliveryPlace,
  findVendor,
  normalizeNigerianPhone,
  type MarketOrderView,
  type MarketSummary,
  type PlaceOrderInput,
} from "@campuslife/shared/market";
import { env } from "../config/env";
import { KeyedLimiter } from "../auth/limits";
import { db } from "../database/database";
import { accounts, marketOrders, type AccountRow, type MarketOrderRow } from "../database/schema";
import { MarketFailure } from "./errors";
import { activePaymentProvider } from "./payments";
import { rolesOf } from "./staff";
import { orderView } from "./views";

const RECENT_ORDERS = 20;
const HOUR_MS = 60 * 60 * 1000;
const ORDER_LOCK_NAMESPACE = 7311;

const ordersPerAccount = new KeyedLimiter(env.MARKET_ORDERS_PER_HOUR, HOUR_MS);
const rider = alias(accounts, "rider");

async function withRiderNames(rows: Promise<{ order: MarketOrderRow; riderName: string | null }[]>): Promise<MarketOrderView[]> {
  return (await rows).map(({ order, riderName }) => orderView(order, riderName));
}

function ordersFor(accountId: string) {
  return db
    .select({ order: marketOrders, riderName: rider.username })
    .from(marketOrders)
    .leftJoin(rider, eq(rider.id, marketOrders.riderAccountId))
    .where(eq(marketOrders.accountId, accountId))
    .orderBy(desc(marketOrders.createdAt))
    .limit(RECENT_ORDERS);
}

export async function marketSummary(account: AccountRow): Promise<MarketSummary> {
  const [orders, roles] = await Promise.all([withRiderNames(ordersFor(account.id)), rolesOf(account.id)]);
  return { deliveryFeeKobo: env.MARKET_DELIVERY_FEE_KOBO, orders, roles };
}

function cleanText(value: string, max: number, required: boolean): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > max || (required && !text)) throw new MarketFailure(MarketError.Invalid);
  return text;
}

export async function placeOrder(account: AccountRow, input: PlaceOrderInput): Promise<MarketOrderView> {
  const vendor = findVendor(input.vendorId);
  if (!vendor) throw new MarketFailure(MarketError.Invalid);
  if (!vendor.delivers) throw new MarketFailure(MarketError.NotDeliverable);
  const place = findDeliveryPlace(input.deliverTo);
  const contactPhone = normalizeNigerianPhone(input.contactPhone);
  if (!place || !contactPhone) throw new MarketFailure(MarketError.Invalid);
  const request = cleanText(input.request, ORDER_REQUEST_MAX, true);
  const deliverNote = cleanText(input.deliverNote, ORDER_NOTE_MAX, false);

  const { row, created } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ORDER_LOCK_NAMESPACE}, hashtext(${account.id}))`);
    const [existing] = await tx
      .select()
      .from(marketOrders)
      .where(and(eq(marketOrders.accountId, account.id), eq(marketOrders.requestId, input.requestId)))
      .limit(1);
    if (existing) return { row: existing, created: false };
    if (!ordersPerAccount.allowed(account.id)) throw new MarketFailure(MarketError.TooManyRequests);
    const [open] = await tx
      .select({ n: count() })
      .from(marketOrders)
      .where(and(eq(marketOrders.accountId, account.id), inArray(marketOrders.status, [...OPEN_ORDER_STATUSES])));
    if ((open?.n ?? 0) >= env.MARKET_MAX_OPEN_ORDERS) throw new MarketFailure(MarketError.TooManyOpen);
    const payment = activePaymentProvider();
    const [inserted] = await tx
      .insert(marketOrders)
      .values({
        id: nanoid(),
        accountId: account.id,
        requestId: input.requestId,
        vendorId: vendor.id,
        request,
        deliverTo: place.id,
        deliverNote,
        contactPhone,
        status: OrderStatus.Placed,
        paymentMethod: payment.method,
        deliveryFeeKobo: env.MARKET_DELIVERY_FEE_KOBO,
      })
      .returning();
    return { row: inserted, created: true };
  });
  if (created) ordersPerAccount.spend(account.id);
  return orderView(row, null);
}

export async function cancelOwnOrder(account: AccountRow, orderId: string): Promise<MarketOrderView> {
  const now = new Date();
  const [row] = await db
    .update(marketOrders)
    .set({ status: OrderStatus.Cancelled, cancelReason: null, cancelledAt: now, updatedAt: now })
    .where(and(eq(marketOrders.id, orderId), eq(marketOrders.accountId, account.id), eq(marketOrders.status, OrderStatus.Placed)))
    .returning();
  if (row) return orderView(row, null);
  const [found] = await db
    .select({ id: marketOrders.id })
    .from(marketOrders)
    .where(and(eq(marketOrders.id, orderId), eq(marketOrders.accountId, account.id)))
    .limit(1);
  throw new MarketFailure(found ? MarketError.Conflict : MarketError.NotFound);
}
