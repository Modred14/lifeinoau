// components/TravelSheet.js
// "How do you want to go?" The sheet that opens when you press Go on a place: trek, keke, bus or your own car, with the price of each.
// Cars show a "Driver" choice when one is hired in the Hire app. Prices come from lib/travel.js; the server charges them again when you arrive.
// Each choice shows how long the trip will take: the road distance divided by the speed of what carries you, plus the walk to and from it (lib3d/tripplan.js).
"use client";
import { useState } from "react";
import { Icon } from "./Icon";
import { naira } from "@/lib/client";
import { MODES, MODE_INFO, fareKobo, fmtDuration } from "@/lib/travel.js";
import { canAfford } from "@/lib/gameStore";
import PlaceActivities from "./PlaceActivities";
import { featuresAt } from "@/lib/features.js";
import "./travel.css";

export default function TravelSheet({ place, here, hasCar, driver, people, distanceM = null, character = null, balanceKobo = null, jailed = false, highlight = null, eta = {}, onGo, onClose }) {
  // `place.blurb` is the short description of the building; it shows under the title so the sheet can replace the info card.
  const [mode, setMode] = useState("trek"), [withDriver, setWithDriver] = useState(true);
  const fare = fareKobo(mode), poor = fare > 0n && !canAfford(fare), useDriver = mode === "car" && !!driver && withDriver;
  const { activities, extra } = featuresAt(place.id, place.kind);
  // the estimate for a choice: "2 min 05 s" once worked out, "…" while it is being worked out, "No route" when the road does not reach there
  const key = (m) => (m === "car" && driver && withDriver ? "carDriver" : m), est = (m) => eta[key(m)];
  const time = (m) => { const e = est(m); return e == null ? "…" : e.ok ? (e.approx ? "about " : "") + fmtDuration(e.secs) : "No route"; };
  const km = (m) => { const e = est(m); return e?.ok ? (e.len >= 1000 ? (e.len / 1000).toFixed(1) + " km" : Math.round(e.len) + " m") : ""; };
  const sub = (m) => (m === "car" && !hasCar ? "No car" : time(m));
  const cur = est(mode), noRoute = cur != null && !cur.ok && mode !== "trek";
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
                <small className="ts-time" aria-label={`Takes ${sub(m)}`}>{sub(m)}</small>
              </button>
            );
          })}
        </div>
        {mode === "car" && hasCar && (
          driver ? (
            <label className="ts-driver"><input type="checkbox" checked={withDriver} onChange={(e) => setWithDriver(e.target.checked)} /><Icon name="driver" size={18} weight="fill" /> Let {driver.name} drive</label>
          ) : (
            <p className="ts-note">You steer, and a map shows the way. Hire a driver in the Hire app on your phone and you can sit back while the car drives you there.</p>
          )
        )}
        {mode === "trek" && <p className="ts-note">You walk it yourself{km("trek") ? ` (${km("trek")})` : ""}. A map at the top shows the way, and you meet other players on the road.</p>}
        {(mode === "keke" || mode === "bus") && <p className="ts-note">The {MODE_INFO[mode].name.toLowerCase()} stops at the nearest kerb and you walk to it. {cur?.ok ? `About ${fmtDuration(cur.secs)} in all, ${km(mode)} by road, including the walk.` : noRoute ? "No road reaches there, so trek instead." : "Working out the route…"} The fare is paid when you get there.</p>}
        {mode === "car" && hasCar && cur?.ok && <p className="ts-note ts-eta">{cur.approx ? "About" : "Takes about"} {fmtDuration(cur.secs)} ({km("car")} by road). Going yourself, it depends how you drive.</p>}
        <PlaceActivities activities={activities} extra={extra} links={place.actions ?? []} character={character} balanceKobo={balanceKobo} jailed={jailed} here={false} highlight={highlight}
          actionLabel={poor ? "Go and start (not enough for the fare)" : noRoute ? "No route" : `Go and start · ${fare === 0n ? "Free" : naira(fare.toString())}`}
          onDo={(a) => { if (!poor && !noRoute) onGo(mode, useDriver, a.act); }} />
        <button type="button" className="go ts-go" disabled={poor || noRoute} data-sound="confirm" onClick={() => onGo(mode, useDriver, null)}>
          {poor ? `You need ${naira(fare.toString())}` : noRoute ? "No route" : `Go · ${fare === 0n ? "Free" : naira(fare.toString())}`}
        </button>
      </div>
    </div>
  );
}