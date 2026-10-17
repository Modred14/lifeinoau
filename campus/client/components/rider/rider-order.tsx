"use client";

import { useState } from "react";
import { KOBO_PER_NAIRA, ORDER_CANCEL_REASON_MAX, OrderStatus, formatNaira, type RiderOrderView } from "@campuslife/shared/market/orders";
import { cancelRiderOrder, claimRiderOrder, deliverRiderOrder, marketErrorMessage, pickUpRiderOrder } from "@campus/lib/api/market";

const COPY = {
  order: "Order",
  buyAt: "Buy at",
  deliverTo: "Deliver to",
  customer: "Customer",
  call: "Call",
  take: "Take this order",
  price: "Item price in naira",
  pickedUp: "I have bought it",
  collect: (total: string, fee: string) => `Collect ${total} from the customer. That is the items plus ${fee} delivery.`,
  delivered: "Delivered and paid",
  cannot: "I can't complete this",
  reason: "Why? The customer sees this.",
  confirmCancel: "Cancel the order",
  keep: "Keep the order",
  priceError: "Enter the item price in naira.",
  reasonError: "Say why the order can't be completed.",
  takenBy: "Taken by",
};

interface RiderOrderProps {
  order: RiderOrderView;
  onChanged: () => void;
}

export function RiderOrder({ order, onChanged }: RiderOrderProps) {
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(marketErrorMessage(err));
    }
    setBusy(false);
    onChanged();
  };

  const pickUp = () => {
    const naira = Number(price.replace(/[,\s₦]/g, ""));
    if (!Number.isFinite(naira) || naira <= 0) return setError(COPY.priceError);
    void run(() => pickUpRiderOrder(order.id, Math.round(naira * KOBO_PER_NAIRA)));
  };

  const cancel = () => {
    if (!reason.trim()) return setError(COPY.reasonError);
    void run(() => cancelRiderOrder(order.id, reason));
  };

  const fee = formatNaira(order.deliveryFeeKobo);
  return (
    <li className="rd-order">
      <p className="rd-code">{COPY.order} {order.code}</p>
      <p><b>{COPY.buyAt} {order.vendorName}</b>{order.vendorArea ? `, ${order.vendorArea}` : ""}</p>
      <p className="rd-request">{order.request}</p>
      <p>{COPY.deliverTo} <b>{order.deliverToName}</b>{order.deliverNote ? `, ${order.deliverNote}` : ""}</p>
      <p>
        {COPY.customer} @{order.customerName}
        {order.contactPhone && <> · <a href={`tel:${order.contactPhone}`}>{COPY.call} {order.contactPhone}</a></>}
      </p>
      {!order.mine && order.riderName && <p className="rd-muted">{COPY.takenBy} @{order.riderName}</p>}
      {error && <p className="rd-error" role="alert">{error}</p>}

      {order.status === OrderStatus.Placed && <button type="button" className="rd-btn" disabled={busy} onClick={() => run(() => claimRiderOrder(order.id))}>{COPY.take}</button>}

      {order.status === OrderStatus.Claimed && !cancelling && (
        <>
          <label className="rd-label" htmlFor={`price-${order.id}`}>{COPY.price}</label>
          <input id={`price-${order.id}`} className="rd-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          <button type="button" className="rd-btn" disabled={busy} onClick={pickUp}>{COPY.pickedUp}</button>
        </>
      )}

      {order.status === OrderStatus.PickedUp && order.totalKobo !== null && !cancelling && (
        <>
          <p className="rd-collect">{COPY.collect(formatNaira(order.totalKobo), fee)}</p>
          <button type="button" className="rd-btn" disabled={busy} onClick={() => run(() => deliverRiderOrder(order.id))}>{COPY.delivered}</button>
        </>
      )}

      {order.status !== OrderStatus.Placed && !cancelling && <button type="button" className="rd-btn rd-btn-quiet" disabled={busy} onClick={() => setCancelling(true)}>{COPY.cannot}</button>}
      {cancelling && (
        <>
          <label className="rd-label" htmlFor={`reason-${order.id}`}>{COPY.reason}</label>
          <input id={`reason-${order.id}`} className="rd-input" maxLength={ORDER_CANCEL_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="rd-btn" disabled={busy} onClick={cancel}>{COPY.confirmCancel}</button>
          <button type="button" className="rd-btn rd-btn-quiet" disabled={busy} onClick={() => setCancelling(false)}>{COPY.keep}</button>
        </>
      )}
    </li>
  );
}
