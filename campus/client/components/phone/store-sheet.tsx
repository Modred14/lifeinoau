"use client";

import { useEffect, useRef } from "react";
import type { Phone } from "@campuslife/shared";
import { naira } from "./format";

interface StoreSheetProps {
  phone: Phone;
  current: Phone;
  cash: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function StoreSheet({ phone, current, cash, onCancel, onConfirm }: StoreSheetProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus({ preventScroll: true }), []);
  return (
    <div className="ph-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div
        className="ph-sheet"
        role="alertdialog"
        aria-label={`Buy ${phone.name}`}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const first = buttons[0];
            const last = buttons.at(-1);
            event.stopPropagation();
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            return;
          }
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        <span className="ph-sheet-grip" aria-hidden="true" />
        <h3>Buy {phone.name}?</h3>
        <p>
          It costs {naira(phone.price)} and replaces your {current.name}. You will have {naira(cash - phone.price)} left.
        </p>
        <div className="ph-sheet-actions">
          <button ref={cancel} type="button" className="ph-btn ph-btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ph-btn" disabled={cash < phone.price || current.id === phone.id} onClick={onConfirm}>
            Pay {naira(phone.price)}
          </button>
        </div>
      </div>
    </div>
  );
}
