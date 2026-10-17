import { bigint, index, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { OrderStatusCode, PaymentMethodCode, StaffRoleCode } from "@campuslife/shared/market";
import { accounts } from "./accounts";

export const staffRoles = pgTable(
  "staff_roles",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    role: text("role").$type<StaffRoleCode>().notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "staff_roles_pk", columns: [table.accountId, table.role] })],
);

export const marketOrders = pgTable(
  "market_orders",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    vendorId: text("vendor_id").notNull(),
    request: text("request").notNull(),
    deliverTo: text("deliver_to").notNull(),
    deliverNote: text("deliver_note").notNull().default(""),
    contactPhone: text("contact_phone").notNull(),
    status: text("status").$type<OrderStatusCode>().notNull(),
    paymentMethod: text("payment_method").$type<PaymentMethodCode>().notNull(),
    currency: text("currency").notNull().default("NGN"),
    itemCostKobo: bigint("item_cost_kobo", { mode: "number" }),
    deliveryFeeKobo: bigint("delivery_fee_kobo", { mode: "number" }).notNull(),
    riderAccountId: text("rider_account_id").references(() => accounts.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    unique("market_orders_request_unique").on(table.accountId, table.requestId),
    index("market_orders_account_idx").on(table.accountId, table.createdAt),
    index("market_orders_status_idx").on(table.status, table.createdAt),
    index("market_orders_rider_idx").on(table.riderAccountId, table.status),
  ],
);

export type StaffRoleRow = typeof staffRoles.$inferSelect;
export type MarketOrderRow = typeof marketOrders.$inferSelect;
