import { PHONE_ID_MAX_LENGTH, findPhone, sanitizePhoneId, type Background, type BuyPhonePayload, type Phone } from "@campuslife/shared";

export interface PhoneOwner {
  cash: number;
  phone: string;
}

export type PhoneRefusal = "payload" | "unknown" | "same" | "cash";

export type PhoneDecision = { ok: true; phone: Phone; cash: number } | { ok: false; reason: PhoneRefusal; phone?: Phone };

export interface PhonePurchase {
  bought: boolean;
  notice: string;
}

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

export function parseBuyPhone(payload: unknown): BuyPhonePayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length === 0 || id.length > PHONE_ID_MAX_LENGTH) return null;
  return { id };
}

export function decidePhonePurchase(owner: PhoneOwner, payload: unknown): PhoneDecision {
  const request = parseBuyPhone(payload);
  if (!request) return { ok: false, reason: "payload" };
  const phone = findPhone(request.id);
  if (!phone) return { ok: false, reason: "unknown" };
  if (phone.id === owner.phone) return { ok: false, reason: "same", phone };
  if (!Number.isFinite(owner.cash) || owner.cash < phone.price) return { ok: false, reason: "cash", phone };
  return { ok: true, phone, cash: owner.cash - phone.price };
}

function refusalNotice(decision: Extract<PhoneDecision, { ok: false }>, owner: PhoneOwner): string {
  if (decision.reason === "same") return `You already use the ${decision.phone?.name ?? "phone"}.`;
  if (decision.reason === "cash" && decision.phone) {
    const short = decision.phone.price - Math.floor(owner.cash);
    return `The ${decision.phone.name} costs ${naira(decision.phone.price)}. You need ${naira(short)} more.`;
  }
  return "The store could not find that phone.";
}

export function buyPhone(owner: PhoneOwner, payload: unknown): PhonePurchase {
  const decision = decidePhonePurchase(owner, payload);
  if (!decision.ok) return { bought: false, notice: refusalNotice(decision, owner) };
  owner.cash = decision.cash;
  owner.phone = decision.phone.id;
  return { bought: true, notice: `📱 You bought the ${decision.phone.name} for ${naira(decision.phone.price)}.` };
}

export function initialPhone(saved: unknown, background: Background): string {
  return sanitizePhoneId(saved, background);
}
