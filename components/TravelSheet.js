// components/TravelSheet.js
// "How do you want to go?" The sheet that opens when you press Go on a place: trek, keke, bus or your own car, with the price of each.
// Cars show a "Driver" choice when one is hired in the Hire app. Prices come from lib/travel.js; the server charges them again when you arrive.
"use client";
import { useState } from "react";
import { Icon } from "./Icon";
import { naira } from "@/lib/client";
import { MODES, MODE_INFO, fareKobo, RIDE_SECONDS } from "@/lib/travel.js";
import { canAfford } from "@/lib/gameStore";
import PlaceActivities from "./PlaceActivities";
import { featuresAt } from "@/lib/features.js";
import "./travel.css";

export default function TravelSheet({ place, here, hasCar, driver, people, distanceM = null, character = null, balanceKobo = null, jailed = false, highlight = null, onGo, onClose }) {
  // `place.blurb` is the short description of the building; it shows under the title so the sheet can replace the info card.
  const [mode, setMode] = useState("trek"), [withDriver, setWithDriver] = useState(true);
  const fare = fareKobo(mode), poor = fare > 0n && !canAfford(fare), useDriver = mode === "car" && !!driver && withDriver;
  const { activities, extra } = featuresAt(place.id, place.kind);
  const sub = (m) => (m === "car" ? (!hasCar ? "No car" : driver ? `${RIDE_SECONDS.driver}s with driver` : "You drive") : MODE_INFO[m].sub);
  return (
    <div className="ts-scrim" onClick={onClose}>
      <div className="ts" role="dialog" aria-modal="true" aria-label={`Go to ${place.name}`} onClick={(e) => e.stopPropagation()}>
        <i className="ts-grab" aria-hidden="true" />
        <header className="ts-head">
          <span className="ts-ico"><Icon name="pin" size={22} weight="fill" /></span>
          <div><b>{place.name}</b><small>{here ? `From ${here}` : "OAU campus"}{people > 0 ? ` · ${people} player${people === 1 ? "" : "s"} there now` : ""}</small></div>
          <button type="button" className="ghost ts-x" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
        {place.blurb && <p className="ts-blurb">{place.blurb}</p>}
        <p className="ts-info">
          <span><Icon name="pin" size={14} weight="fill" /> {here ? `From ${here}` : "From where you are"}{distanceM != null ? `, about ${distanceM} m away` : ""}</span>
          <span><Icon name="coins" size={14} /> Fares: {MODES.filter((m) => m !== "car" || hasCar).map((m) => `${MODE_INFO[m].name} ${fareKobo(m) === 0n ? "free" : naira(fareKobo(m).toString())}`).join(" · ")}</span>
        </p>
        <div className="ts-modes" role="radiogroup" aria-label="How to travel">
          {MODES.map((m) => {
            const off = m === "car" && !hasCar, price = fareKobo(m);
            return (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className="ts-mode" data-on={mode === m ? "1" : undefined} disabled={off} onClick={() => setMode(m)}>
                <Icon name={MODE_INFO[m].icon} size={26} weight="fill" />
                <b>{MODE_INFO[m].name}</b>
                <span className="num">{price === 0n ? "Free" : naira(price.toString())}</span>
                <small>{sub(m)}</small>
              </button>
            );
          })}
        </div>
        {mode === "car" && hasCar && (
          driver ? (
            <label className="ts-driver"><input type="checkbox" checked={withDriver} onChange={(e) => setWithDriver(e.target.checked)} /><Icon name="driver" size={18} weight="fill" /> Let {driver.name} drive ({RIDE_SECONDS.driver} seconds)</label>
          ) : (
            <p className="ts-note">You steer, and a map shows the way. Hire a driver in the Hire app on your phone and the trip takes {RIDE_SECONDS.driver} seconds.</p>
          )
        )}
        {mode === "trek" && <p className="ts-note">You walk it yourself. A map at the top shows the way, and you meet other players on the road.</p>}
        {(mode === "keke" || mode === "bus") && <p className="ts-note">Sit back: the {MODE_INFO[mode].name.toLowerCase()} takes {RIDE_SECONDS[mode]} seconds. The fare is paid when you get there.</p>}
        <PlaceActivities activities={activities} extra={extra} links={place.actions ?? []} character={character} balanceKobo={balanceKobo} jailed={jailed} here={false} highlight={highlight}
          actionLabel={poor ? "Go and start (not enough for the fare)" : `Go and start · ${fare === 0n ? "Free" : naira(fare.toString())}`}
          onDo={(a) => { if (!poor) onGo(mode, useDriver, a.act); }} />
        <button type="button" className="go ts-go" disabled={poor} data-sound="confirm" onClick={() => onGo(mode, useDriver, null)}>
          {poor ? `You need ${naira(fare.toString())}` : `Go · ${fare === 0n ? "Free" : naira(fare.toString())}`}
        </button>
      </div>
    </div>
  );
}