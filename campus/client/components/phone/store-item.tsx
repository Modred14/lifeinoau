import { PHONE_PLATFORM_LABEL, PHONE_TIER_LABEL, type Phone } from "@campuslife/shared";
import Image from "next/image";
import { PiCheckCircleFill, PiWarningCircleFill } from "react-icons/pi";
import { naira } from "./format";
import { PhoneDevice } from "./phone-device";
import type { Purchase } from "./use-purchase";

interface StoreItemProps {
  phone: Phone;
  current: boolean;
  cash: number;
  purchase: Purchase;
  onPick: (phone: Phone) => void;
}

export function StoreItem({ phone, current, cash, purchase, onPick }: StoreItemProps) {
  const mine = purchase.status !== "idle" && purchase.id === phone.id;
  const pending = mine && purchase.status === "pending";
  const failed = mine && purchase.status === "failed";
  const short = phone.price - cash;
  const busy = purchase.status === "pending";
  return (
    <li className={current ? "ph-card ph-store-item ph-store-current" : "ph-card ph-store-item"}>
      {phone.image ? <Image className="ph-product-image" src={phone.image} alt={`${phone.name} colours and front display`} width={600} height={440} unoptimized /> : <PhoneDevice phone={phone} preview />}
      <div className="ph-store-text">
        <b>{phone.name}</b>
        <small>
          {PHONE_PLATFORM_LABEL[phone.platform]} · {PHONE_TIER_LABEL[phone.tier]}
        </small>
        <span>{phone.spec}</span>
        <span className="ph-price">{naira(phone.price)}</span>
        {current ? (
          <span className="ph-tag">
            <PiCheckCircleFill aria-hidden="true" />
            Your phone
          </span>
        ) : (
          <button
            type="button"
            className="ph-btn"
            disabled={busy || short > 0}
            aria-busy={pending || undefined}
            aria-label={`Buy ${phone.name} for ${naira(phone.price)}`}
            onClick={() => onPick(phone)}
          >
            {pending ? "Buying…" : "Buy"}
          </button>
        )}
        {!current && short > 0 && <span className="ph-short">Not enough money. You need {naira(short)} more.</span>}
        {failed && (
          <span className="ph-error" role="alert">
            <PiWarningCircleFill aria-hidden="true" />
            That did not go through. Check your cash and try again.
          </span>
        )}
      </div>
    </li>
  );
}
