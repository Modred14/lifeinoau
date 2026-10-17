import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  MarketError,
  OPEN_ORDER_STATUSES,
  ORDER_CANCEL_REASON_MAX,
  ORDER_ITEM_COST_MAX_KOBO,
  OrderStatus,
  StaffRole,
  type RiderOrderView,
  type RiderQueue,
  type StaffRoleCode,
} from "@campuslife/shared/market";
import { db } from "../database/database";
import { accounts, marketOrders, type AccountRow, type MarketOrderRow } from "../database/schema";
import { MarketFailure } from "./errors";
import { riderOrderView } from "./views";

const QUEUE_LIMIT = 50;
const customer = alias(accounts, "customer");
const rider = alias(accounts, "rider");

export interface Staff {
  account: AccountRow;
  roles: StaffRoleCode[];
}

const isAdmin = (staff: Staff) => staff.roles.includes(StaffRole.Admin);

function select(where: SQL | undefined, order: "oldest" | "newest") {
  return db
    .select({ order: marketOrders, customerName: customer.username, riderName: rider.username })
    .from(marketOrders)
    .innerJoin(customer, eq(customer.id, marketOrders.accountId))
    .leftJoin(rider, eq(rider.id, marketOrders.riderAccountId))
    .where(where)
    .orderBy(order === "oldest" ? asc(marketOrders.createdAt) : desc(marketOrders.createdAt))
    .limit(QUEUE_LIMIT);
}

type Joined = { order: MarketOrderRow; customerName: string; riderName: string | null };

function view(staff: Staff, rows: Joined[]): RiderOrderView[] {
  return rows.map((r) => riderOrderView(r.order, { customer: r.customerName, rider: r.riderName }, staff.account.id));
}

export async function riderQueue(staff: Staff): Promise<RiderQueue> {
  const active = [OrderStatus.Claimed, OrderStatus.PickedUp];
  const mineWhere = isAdmin(staff)
    ? inArray(marketOrders.status, active)
    : and(eq(marketOrders.riderAccountId, staff.account.id), inArray(marketOrders.status, active));
  const [open, mine] = await Promise.all([select(eq(marketOrders.status, OrderStatus.Placed), "oldest"), select(mineWhere, "oldest")]);
  return { open: view(staff, open), mine: view(staff, mine) };
}

async function viewById(staff: Staff, id: string): Promise<RiderOrderView> {
  const rows = await select(eq(marketOrders.id, id), "newest");
  if (!rows[0]) throw new MarketFailure(MarketError.NotFound);
  return view(staff, rows)[0];
}

async function failureFor(id: string): Promise<never> {
  const [found] = await db.select({ id: marketOrders.id }).from(marketOrders).where(eq(marketOrders.id, id)).limit(1);
  throw new MarketFailure(found ? MarketError.Conflict : MarketError.NotFound);
}

async function transition(staff: Staff, id: string, where: SQL | undefined, set: Partial<MarketOrderRow>): Promise<RiderOrderView> {
  const [row] = await db
    .update(marketOrders)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(marketOrders.id, id), where))
    .returning({ id: marketOrders.id });
  if (!row) return failureFor(id);
  return viewById(staff, id);
}

const ownedBy = (staff: Staff) => (isAdmin(staff) ? undefined : eq(marketOrders.riderAccountId, staff.account.id));

export function claimOrder(staff: Staff, id: string) {
  return transition(staff, id, eq(marketOrders.status, OrderStatus.Placed), {
    status: OrderStatus.Claimed,
    riderAccountId: staff.account.id,
    claimedAt: new Date(),
  });
}

export function markPickedUp(staff: Staff, id: string, itemCostKobo: number) {
  if (!Number.isInteger(itemCostKobo) || itemCostKobo <= 0 || itemCostKobo > ORDER_ITEM_COST_MAX_KOBO) throw new MarketFailure(MarketError.Invalid);
  return transition(staff, id, and(eq(marketOrders.status, OrderStatus.Claimed), ownedBy(staff)), {
    status: OrderStatus.PickedUp,
    itemCostKobo,
    pickedUpAt: new Date(),
  });
}

export function markDelivered(staff: Staff, id: string) {
  return transition(staff, id, and(eq(marketOrders.status, OrderStatus.PickedUp), ownedBy(staff)), {
    status: OrderStatus.Delivered,
    deliveredAt: new Date(),
  });
}

export function cancelAsStaff(staff: Staff, id: string, reason: string) {
  const text = reason.replace(/\s+/g, " ").trim();
  if (!text || text.length > ORDER_CANCEL_REASON_MAX) throw new MarketFailure(MarketError.Invalid);
  const open = inArray(marketOrders.status, [...OPEN_ORDER_STATUSES]);
  const allowed = isAdmin(staff) ? open : and(open, or(eq(marketOrders.status, OrderStatus.Claimed), eq(marketOrders.status, OrderStatus.PickedUp)), eq(marketOrders.riderAccountId, staff.account.id));
  return transition(staff, id, allowed, { status: OrderStatus.Cancelled, cancelReason: text, cancelledAt: new Date() });
}
