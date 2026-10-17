import { PaymentMethod, type PaymentMethodCode } from "@campuslife/shared/market";

/** What the customer does next to pay. Only pay on delivery exists today; a gateway adds a "redirect" kind. */
export type PaymentStart = { kind: "on_delivery" } | { kind: "redirect"; url: string };

export interface PaymentProvider {
  method: PaymentMethodCode;
  start(order: { id: string; deliveryFeeKobo: number }): Promise<PaymentStart>;
}

const payOnDelivery: PaymentProvider = {
  method: PaymentMethod.OnDelivery,
  start: async () => ({ kind: "on_delivery" }),
};

export function activePaymentProvider(): PaymentProvider {
  return payOnDelivery;
}
