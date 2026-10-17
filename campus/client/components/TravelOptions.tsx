"use client";

import type { IconType } from "react-icons";
import { PiBusDuotone, PiMotorcycleDuotone, PiPersonSimpleWalkDuotone, PiTaxiDuotone, PiVanDuotone } from "react-icons/pi";
import type { TravelMode } from "@campuslife/shared";
import type { TravelOption } from "@campus/game/CampusView";
import "./travel-options.css";

const MODE_ICON: Record<TravelMode, IconType> = {
  walk: PiPersonSimpleWalkDuotone,
  okada: PiMotorcycleDuotone,
  keke: PiTaxiDuotone,
  shuttle: PiVanDuotone,
  bus: PiBusDuotone,
};

const COPY = {
  heading: (place: string) => `To ${place}`,
  free: "Free",
  back: "Not now",
  cash: "Cash",
  minutes: (n: number) => `${n} min`,
  distance: (m: number) => (m >= METERS_PER_KM ? `${(m / METERS_PER_KM).toFixed(1)} km` : `${Math.max(DISTANCE_STEP, Math.round(m / DISTANCE_STEP) * DISTANCE_STEP)} m`),
  fare: (n: number) => `₦${n.toLocaleString("en-NG")}`,
};

const SECONDS_PER_MINUTE = 60;
const METERS_PER_KM = 1000;
const DISTANCE_STEP = 10;

export function TravelOptions({ destination, cash, options, onPick, onBack }: { destination: string; cash: number; options: TravelOption[]; onPick: (option: TravelOption) => void; onBack: () => void }) {
  return (
    <div className="travel-options" role="dialog" aria-label={COPY.heading(destination)}>
      <header className="travel-options-head">
        <h3 className="travel-options-title">{COPY.heading(destination)}</h3>
        <span className="travel-options-cash">
          {COPY.cash} <b>{COPY.fare(cash)}</b>
        </span>
      </header>
      <ul className="travel-options-list">
        {options.map((option) => {
          const Icon = MODE_ICON[option.mode];
          const note = option.blocked ?? option.detail;
          return (
            <li key={`${option.mode}-${option.label}`}>
              <button className="travel-option" disabled={!!option.blocked} onClick={() => onPick(option)}>
                <Icon aria-hidden="true" focusable="false" />
                <span>
                  <span className="travel-option-name">{option.label}</span>
                  {note && <span className="travel-option-note">{note}</span>}
                </span>
                <span className="travel-option-cost">
                  <span className="travel-option-fare">{option.fare > 0 ? COPY.fare(option.fare) : COPY.free}</span>
                  <span className="travel-option-time">
                    {COPY.distance(option.meters)} · {COPY.minutes(Math.max(1, Math.round(option.seconds / SECONDS_PER_MINUTE)))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="travel-options-back" onClick={onBack}>
        {COPY.back}
      </button>
    </div>
  );
}
