import { createEndpoint } from "@colyseus/core";
import { z } from "zod";
import { MarketError, ORDER_CANCEL_REASON_MAX, ORDER_NOTE_MAX, ORDER_REQUEST_MAX, StaffRole } from "@campuslife/shared/market";
import { env } from "../config/env";
import { AuthFailure, authenticate } from "../auth/AccountService";
import { KeyedLimiter } from "../auth/limits";
import { bearer, clientIp, fromProxy, reply } from "../http/common";
import type { AccountRow } from "../database/schema";
import { MarketFailure } from "./errors";
import { cancelOwnOrder, marketSummary, placeOrder } from "./OrderService";
import { cancelAsStaff, claimOrder, markDelivered, markPickedUp, riderQueue, type Staff } from "./RiderService";
import { rolesOf } from "./staff";

const IP_WINDOW_MS = 15 * 60 * 1000;
const ID_MAX = 64;
const PHONE_MAX = 32;

const ipMarketRequests = new KeyedLimiter(env.MARKET_REQUESTS_PER_IP, IP_WINDOW_MS);

const id = z.string().min(1).max(ID_MAX);
const orderRef = z.object({ orderId: id });
const placeBody = z.object({
  requestId: id,
  vendorId: id,
  request: z.string().max(ORDER_REQUEST_MAX * 2),
  deliverTo: id,
  deliverNote: z.string().max(ORDER_NOTE_MAX * 2),
  contactPhone: z.string().max(PHONE_MAX),
});
const pickupBody = orderRef.extend({ itemCostKobo: z.number().int() });
const cancelBody = orderRef.extend({ reason: z.string().max(ORDER_CANCEL_REASON_MAX * 2) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new MarketFailure(MarketError.Invalid);
  return parsed.data;
}

type Handler<C> = (caller: C, body: unknown) => Promise<object>;

function endpoint<C>(path: string, resolve: (account: AccountRow) => Promise<C>, handler: Handler<C>) {
  return createEndpoint(path, { method: "POST" }, async (ctx) => {
    const request = ctx.request;
    if (!request) return reply({ error: MarketError.Unavailable }, 503);
    if (!fromProxy(request)) return reply({ error: MarketError.SignedOut }, 403);
    if (!ipMarketRequests.take(clientIp(request.headers))) return reply({ error: MarketError.TooManyRequests }, 429);
    try {
      const account = await authenticate(bearer(request));
      return reply(await handler(await resolve(account), ctx.body));
    } catch (err) {
      if (err instanceof MarketFailure) return reply({ error: err.code }, err.status);
      if (err instanceof AuthFailure) return reply({ error: MarketError.SignedOut }, 401);
      console.error(`[market] ${path} failed`, err);
      return reply({ error: MarketError.Unavailable }, 503);
    }
  });
}

const customer = async (account: AccountRow) => account;

async function staff(account: AccountRow): Promise<Staff> {
  const roles = await rolesOf(account.id);
  if (!roles.includes(StaffRole.Rider) && !roles.includes(StaffRole.Admin)) throw new MarketFailure(MarketError.Forbidden);
  return { account, roles };
}

export const marketEndpoints = {
  marketSummary: endpoint("/market/summary", customer, (account) => marketSummary(account)),
  marketOrder: endpoint("/market/order", customer, async (account, body) => ({ order: await placeOrder(account, parse(placeBody, body)) })),
  marketCancel: endpoint("/market/cancel", customer, async (account, body) => ({ order: await cancelOwnOrder(account, parse(orderRef, body).orderId) })),
  riderQueue: endpoint("/market/rider/queue", staff, (s) => riderQueue(s)),
  riderClaim: endpoint("/market/rider/claim", staff, async (s, body) => ({ order: await claimOrder(s, parse(orderRef, body).orderId) })),
  riderPickup: endpoint("/market/rider/pickup", staff, async (s, body) => {
    const input = parse(pickupBody, body);
    return { order: await markPickedUp(s, input.orderId, input.itemCostKobo) };
  }),
  riderDeliver: endpoint("/market/rider/deliver", staff, async (s, body) => ({ order: await markDelivered(s, parse(orderRef, body).orderId) })),
  riderCancel: endpoint("/market/rider/cancel", staff, async (s, body) => {
    const input = parse(cancelBody, body);
    return { order: await cancelAsStaff(s, input.orderId, input.reason) };
  }),
};
