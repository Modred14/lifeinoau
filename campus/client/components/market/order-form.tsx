"use client";
import { CampusDropdown } from "../CampusDropdown";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { nanoid } from "nanoid";
import { DELIVERY_PLACES, ORDER_NOTE_MAX, ORDER_REQUEST_MAX, formatNaira, normalizeNigerianPhone, type MarketOrderView, type Point, type Vendor } from "@campuslife/shared/market";
import { marketErrorMessage, placeMarketOrder } from "@campus/lib/api/market";
import { STORAGE_KEYS } from "@campus/lib/storage";

const COPY = {
  heading: "Order from",
  request: "What should the rider buy?",
  requestHint: "Say what you want and how many. For example: 2 plates of jollof rice and 1 bottle of water.",
  deliverTo: "Deliver to",
  note: "Room or landmark",
  notePlaceholder: "Block C, room 12",
  phone: "Phone number for the rider",
  phonePlaceholder: "0803 123 4567",
  phoneError: "Enter a Nigerian mobile number, like 0803 123 4567.",
  requestError: "Tell the rider what to buy.",
  pay: "Pay the rider when it arrives",
  payDetail: (fee: string) => `You pay the price of the items plus ${fee} delivery. The rider confirms the item price at the shop. No money leaves your game wallet.`,
  feeLoading: "Checking the delivery fee…",
  submit: "Place order",
  sending: "Placing order…",
  back: "Back",
};

interface Saved {
  deliverTo?: string;
  note?: string;
  phone?: string;
}

function readSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.delivery);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return typeof value === "object" && value !== null ? (value as Saved) : {};
  } catch {
    return {};
  }
}

function nearestHall(from: Point | undefined): string {
  const halls = DELIVERY_PLACES.filter((p) => p.kind === "hostel");
  if (!from || !halls.length) return DELIVERY_PLACES[0].id;
  const away = (p: Point) => Math.hypot(p.x - from.x, p.y - from.y);
  return halls.reduce((best, p) => (away(p.door) < away(best.door) ? p : best)).id;
}

interface OrderFormProps {
  vendor: Vendor;
  from: Point | undefined;
  deliveryFeeKobo: number | null;
  onPlaced: (order: MarketOrderView) => void;
  onBack: () => void;
}

export function OrderForm({ vendor, from, deliveryFeeKobo, onPlaced, onBack }: OrderFormProps) {
  const saved = useMemo(readSaved, []);
  const ids = useId();
  const requestId = useRef(nanoid());
  const [request, setRequest] = useState("");
  const [deliverTo, setDeliverTo] = useState(() => (saved.deliverTo && DELIVERY_PLACES.some((p) => p.id === saved.deliverTo) ? saved.deliverTo : nearestHall(from)));
  const [note, setNote] = useState(saved.note ?? "");
  const [phone, setPhone] = useState(saved.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    if (!request.trim()) return setError(COPY.requestError);
    if (!normalizeNigerianPhone(phone)) return setError(COPY.phoneError);
    setError(null);
    setSending(true);
    try {
      const order = await placeMarketOrder({ requestId: requestId.current, vendorId: vendor.id, request, deliverTo, deliverNote: note, contactPhone: phone });
      try {
        localStorage.setItem(STORAGE_KEYS.delivery, JSON.stringify({ deliverTo, note, phone } satisfies Saved));
      } catch {
        /* storage unavailable */
      }
      requestId.current = nanoid();
      onPlaced(order);
    } catch (err) {
      setError(marketErrorMessage(err));
      setSending(false);
    }
  };

  return (
    <form className="mk-form" onSubmit={submit} noValidate>
      <h3 className="mk-title">{COPY.heading} {vendor.name}</h3>
      <label className="mk-field" htmlFor={`${ids}-request`}>{COPY.request}</label>
      <textarea id={`${ids}-request`} className="mk-input" rows={3} maxLength={ORDER_REQUEST_MAX} value={request} onChange={(e) => setRequest(e.target.value)} aria-describedby={`${ids}-hint`} required />
      <p id={`${ids}-hint`} className="mk-muted">{COPY.requestHint}</p>
      <label className="mk-field" htmlFor={`${ids}-to`}>{COPY.deliverTo}</label>
      <CampusDropdown id={`${ids}-to`} label={COPY.deliverTo} className="mk-input" value={deliverTo} onChange={setDeliverTo} options={DELIVERY_PLACES.map((place) => ({ value: place.id, label: place.name }))} />
      <label className="mk-field" htmlFor={`${ids}-note`}>{COPY.note}</label>
      <input id={`${ids}-note`} className="mk-input" type="text" maxLength={ORDER_NOTE_MAX} placeholder={COPY.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="mk-field" htmlFor={`${ids}-phone`}>{COPY.phone}</label>
      <input id={`${ids}-phone`} className="mk-input" type="tel" inputMode="tel" autoComplete="tel" placeholder={COPY.phonePlaceholder} value={phone} onChange={(e) => setPhone(e.target.value)} required />
      <div className="mk-pay">
        <b>{COPY.pay}</b>
        <span>{deliveryFeeKobo === null ? COPY.feeLoading : COPY.payDetail(formatNaira(deliveryFeeKobo))}</span>
      </div>
      {error && <p className="mk-error" role="alert">{error}</p>}
      <div className="mk-actions">
        <button type="submit" className="mk-btn" disabled={sending || deliveryFeeKobo === null}>{sending ? COPY.sending : COPY.submit}</button>
        <button type="button" className="mk-btn mk-btn-quiet" onClick={onBack} disabled={sending}>{COPY.back}</button>
      </div>
    </form>
  );
}
