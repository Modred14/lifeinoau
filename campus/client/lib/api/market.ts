import { MarketError, type MarketErrorCode, type MarketOrderView, type MarketSummary, type PlaceOrderInput, type RiderOrderView, type RiderQueue } from "@campuslife/shared/market/orders";

const MARKET_MESSAGES: Record<MarketErrorCode, string> = {
  [MarketError.Invalid]: "Check the order details and phone number, then try again.",
  [MarketError.SignedOut]: "Sign in to continue.",
  [MarketError.Forbidden]: "This page is for riders.",
  [MarketError.NotFound]: "We couldn't find that order.",
  [MarketError.Conflict]: "That order has already moved on. Refresh to see where it is.",
  [MarketError.NotDeliverable]: "We don't deliver from this place yet.",
  [MarketError.TooManyOpen]: "You already have orders on the way. Wait for one to arrive first.",
  [MarketError.TooManyRequests]: "Too many requests. Wait a few minutes and try again.",
  [MarketError.Unavailable]: "We couldn't reach the campus server. Try again shortly.",
};
const KNOWN_CODES = new Set<string>(Object.values(MarketError));

export class MarketRequestError extends Error {
  constructor(readonly code: MarketErrorCode) {
    super(MARKET_MESSAGES[code]);
  }
}

export function marketErrorMessage(err: unknown): string {
  return err instanceof MarketRequestError ? err.message : MARKET_MESSAGES[MarketError.Unavailable];
}

async function call<T>(route: string, body: object = {}): Promise<T> {
  let res: Response;
  let data: unknown;
  try {
    res = await fetch(`/api/market/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch {
    throw new MarketRequestError(MarketError.Unavailable);
  }
  if (!res.ok) {
    const code = typeof data === "object" && data !== null ? (data as { error?: unknown }).error : undefined;
    throw new MarketRequestError(typeof code === "string" && KNOWN_CODES.has(code) ? (code as MarketErrorCode) : MarketError.Unavailable);
  }
  return data as T;
}

export const getMarketSummary = () => call<MarketSummary>("summary");
export const placeMarketOrder = async (input: PlaceOrderInput) => (await call<{ order: MarketOrderView }>("order", input)).order;
export const cancelMarketOrder = async (orderId: string) => (await call<{ order: MarketOrderView }>("cancel", { orderId })).order;

export const getRiderQueue = () => call<RiderQueue>("rider/queue");
const riderAction = async (action: string, body: object) => (await call<{ order: RiderOrderView }>(`rider/${action}`, body)).order;
export const claimRiderOrder = (orderId: string) => riderAction("claim", { orderId });
export const pickUpRiderOrder = (orderId: string, itemCostKobo: number) => riderAction("pickup", { orderId, itemCostKobo });
export const deliverRiderOrder = (orderId: string) => riderAction("deliver", { orderId });
export const cancelRiderOrder = (orderId: string, reason: string) => riderAction("cancel", { orderId, reason });
