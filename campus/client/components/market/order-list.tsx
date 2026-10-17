"use client";

import { useState } from "react";
import { ORDER_STATUS_LABEL, OrderStatus, formatNaira, type MarketOrderView } from "@campuslife/shared/market/orders";
import { cancelMarketOrder, marketErrorMessage } from "@campus/lib/api/market";

const COPY = {
  empty: "You haven't ordered anything yet.",
  cancel: "Cancel order",
  cancelling: "Cancelling…",
  code: "Order",
  to: "To",
  rider: "Rider",
  priceLater: (fee: string) => `The rider confirms the item price at the shop. Delivery is ${fee}.`,
  total: (items: string, fee: string, total: string) => `Items ${items} + delivery ${fee} = ${total}. Pay the rider.`,
  paid: (total: string) => `Paid ${total} to the rider.`,
};

function money(order: MarketOrderView): string {
  const fee = formatNaira(order.deliveryFeeKobo);
  if (order.itemCostKobo === null || order.totalKobo === null) return COPY.priceLater(fee);
  const total = formatNaira(order.totalKobo);
  return order.status === OrderStatus.Delivered ? COPY.paid(total) : COPY.total(formatNaira(order.itemCostKobo), fee, total);
}

export function OrderList({ orders, onChanged }: { orders: readonly MarketOrderView[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await cancelMarketOrder(id);
    } catch (err) {
      setError(marketErrorMessage(err));
    }
    setBusy(null);
    onChanged();
  };

  if (!orders.length) return <p className="mk-muted">{COPY.empty}</p>;
  return (
    <>
      {error && <p className="mk-error" role="alert">{error}</p>}
      <ul className="mk-orders">
        {orders.map((order) => (
          <li key={order.id} className={`mk-order mk-order-${order.status}`}>
            <p className="mk-order-status" role="status">{ORDER_STATUS_LABEL[order.status]}</p>
            <b>{order.vendorName}</b>
            <p>{order.request}</p>
            <p className="mk-muted">{COPY.to} {order.deliverToName}{order.deliverNote ? `, ${order.deliverNote}` : ""}</p>
            {order.status !== OrderStatus.Cancelled && <p className="mk-muted">{money(order)}</p>}
            {order.cancelReason && <p className="mk-muted">{order.cancelReason}</p>}
            <p className="mk-muted">{COPY.code} {order.code}{order.riderName ? ` · ${COPY.rider} @${order.riderName}` : ""}</p>
            {order.status === OrderStatus.Placed && (
              <button type="button" className="mk-btn mk-btn-quiet" disabled={busy !== null} onClick={() => cancel(order.id)}>{busy === order.id ? COPY.cancelling : COPY.cancel}</button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
