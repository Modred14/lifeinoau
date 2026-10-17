import { findShopItem, type BuyItemPayload, type ShopReceipt } from "@campuslife/shared";

export interface Shopper {
  cash: number;
  food: number;
  energy: number;
  fun: number;
}

export function parseItemPurchase(payload: unknown): BuyItemPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { id, requestId } = payload as Record<string, unknown>;
  if (typeof id !== "string" || id.length > 32 || !/^[a-z0-9-]+$/.test(id)) return null;
  if (typeof requestId !== "string" || !/^[1-9][0-9]{0,15}$/.test(requestId) || !Number.isSafeInteger(Number(requestId))) return null;
  return { id, requestId };
}

export class ShoppingDesk {
  private receipts = new WeakMap<Shopper, ShopReceipt>();

  buy(shopper: Shopper, payload: unknown): ShopReceipt | null {
    const request = parseItemPurchase(payload);
    if (!request) return null;
    const previous = this.receipts.get(shopper);
    if (previous?.requestId === request.requestId) return previous;
    if (previous && Number(request.requestId) < Number(previous.requestId)) return { ...request, ok: false, message: "This checkout expired. Try again." };
    const item = findShopItem(request.id);
    const result: ShopReceipt = { ...request, ok: false, message: "That item is not available." };
    if (item) {
      if (![shopper.cash, shopper.food, shopper.energy, shopper.fun].every(Number.isFinite) || shopper.cash < item.price) {
        result.message = `You need ₦${item.price.toLocaleString("en-NG")} for ${item.name.toLowerCase()}. Check your wallet.`;
      } else if ((item.category === "food" ? shopper.food : shopper.energy) >= 100) {
        result.message = item.category === "food" ? "You are already full. Save your money for later." : "You already feel rested. Save your drink for later.";
      } else {
        shopper.cash -= item.price;
        for (const need of ["food", "energy", "fun"] as const) shopper[need] = Math.max(0, Math.min(100, shopper[need] + item[need]));
        result.ok = true;
        result.message = `${item.name} bought and ${item.category === "food" ? "eaten" : "drunk"} for ₦${item.price.toLocaleString("en-NG")}.`;
      }
    }
    this.receipts.set(shopper, result);
    return result;
  }
}
