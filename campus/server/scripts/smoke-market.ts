import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid, customAlphabet } from "nanoid";
import postgres from "postgres";
import { MarketError, OrderStatus, type MarketOrderView, type MarketSummary, type RiderOrderView, type RiderQueue } from "@campuslife/shared/market";
import { smokeAccount } from "./smoke-account";

const url = process.env.GAME_SERVER_URL ?? "http://localhost:2567";
const suffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6)();
const buyerName = `smoke_buy_${suffix}`;
const riderName = `smoke_ride_${suffix}`;
const COST_KOBO = 2_500 * 100;

try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"));
} catch {
  /* DATABASE_URL may already be in the environment */
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });

async function post<T>(route: string, token: string, body: object = {}): Promise<{ status: number; data: T & { error?: string } }> {
  const res = await fetch(`${url}/market/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T & { error?: string } };
}

type OrderReply = { order: MarketOrderView };
type RiderReply = { order: RiderOrderView };
const order = (overrides: object = {}) => ({
  requestId: nanoid(),
  vendorId: "new-buka",
  request: "2 plates of jollof rice and 1 bottle of water",
  deliverTo: "moremi-hall",
  deliverNote: "Block C, room 12",
  contactPhone: "0803 123 4567",
  ...overrides,
});

try {
  const buyer = await smokeAccount(url, buyerName);
  const rider = await smokeAccount(url, riderName);

  const anonymous = await post("summary", "not-a-token");
  assert.equal(anonymous.status, 401);

  const summary = await post<MarketSummary>("summary", buyer.token);
  assert.equal(summary.status, 200);
  assert.equal(summary.data.deliveryFeeKobo > 0, true);
  assert.deepEqual(summary.data.roles, []);
  assert.equal((await post("rider/queue", buyer.token)).data.error, MarketError.Forbidden);

  assert.equal((await post("order", buyer.token, order({ contactPhone: "12345" }))).data.error, MarketError.Invalid);
  assert.equal((await post("order", buyer.token, order({ request: "   " }))).data.error, MarketError.Invalid);
  assert.equal((await post("order", buyer.token, order({ deliverTo: "nowhere" }))).data.error, MarketError.Invalid);
  assert.equal((await post("order", buyer.token, order({ vendorId: "empire-internet-cafe" }))).data.error, MarketError.NotDeliverable);

  const first = order();
  const placed = await post<OrderReply>("order", buyer.token, first);
  assert.equal(placed.status, 200, JSON.stringify(placed.data));
  assert.equal(placed.data.order.status, OrderStatus.Placed);
  assert.equal(placed.data.order.deliverToName, "Moremi Hall");
  const again = await post<OrderReply>("order", buyer.token, first);
  assert.equal(again.data.order.id, placed.data.order.id, "the same request id returns the same order");

  const second = await post<OrderReply>("order", buyer.token, order({ vendorId: "central-market", request: "1 tin of milk and a pack of Indomie" }));
  assert.equal(second.status, 200);
  assert.equal((await post("order", buyer.token, order())).data.error, MarketError.TooManyOpen);

  const cancelled = await post<OrderReply>("cancel", buyer.token, { orderId: placed.data.order.id });
  assert.equal(cancelled.data.order.status, OrderStatus.Cancelled);
  assert.equal((await post("cancel", buyer.token, { orderId: placed.data.order.id })).data.error, MarketError.Conflict);

  const [riderAccount] = await sql<{ id: string }[]>`select id from accounts where username = ${riderName}`;
  await sql`insert into staff_roles (account_id, role) values (${riderAccount.id}, 'rider') on conflict do nothing`;
  const riderSummary = await post<MarketSummary>("summary", rider.token);
  assert.deepEqual(riderSummary.data.roles, ["rider"]);

  const target = second.data.order.id;
  const queue = await post<RiderQueue>("rider/queue", rider.token);
  const listed = queue.data.open.find((o) => o.id === target);
  assert.ok(listed, "the open order is in the rider queue");
  assert.equal(listed.contactPhone, null, "the phone stays hidden until a rider claims the order");
  assert.equal(listed.customerName, buyerName);

  const claimed = await post<RiderReply>("rider/claim", rider.token, { orderId: target });
  assert.equal(claimed.data.order.status, OrderStatus.Claimed);
  assert.equal(claimed.data.order.contactPhone, "+2348031234567");
  assert.equal((await post("rider/claim", rider.token, { orderId: target })).data.error, MarketError.Conflict);
  assert.equal((await post("cancel", buyer.token, { orderId: target })).data.error, MarketError.Conflict, "students cannot cancel after a rider claims");
  assert.equal((await post("rider/deliver", rider.token, { orderId: target })).data.error, MarketError.Conflict, "delivery needs a pickup first");
  assert.equal((await post("rider/pickup", rider.token, { orderId: target, itemCostKobo: 0 })).data.error, MarketError.Invalid);

  const picked = await post<RiderReply>("rider/pickup", rider.token, { orderId: target, itemCostKobo: COST_KOBO });
  assert.equal(picked.data.order.status, OrderStatus.PickedUp);
  assert.equal(picked.data.order.totalKobo, COST_KOBO + summary.data.deliveryFeeKobo);

  const delivered = await post<RiderReply>("rider/deliver", rider.token, { orderId: target });
  assert.equal(delivered.data.order.status, OrderStatus.Delivered);

  const after = await post<MarketSummary>("summary", buyer.token);
  const mine = after.data.orders.find((o) => o.id === target);
  assert.equal(mine?.status, OrderStatus.Delivered);
  assert.equal(mine?.riderName, riderName);
  assert.equal(mine?.totalKobo, COST_KOBO + summary.data.deliveryFeeKobo);
  assert.equal("contactPhone" in (mine ?? {}), false);

  console.log("smoke-market: all checks passed");
} finally {
  await sql`delete from accounts where username in (${buyerName}, ${riderName})`;
  await sql.end();
}
