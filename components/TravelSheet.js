// components/TravelSheet.js
// "How do you want to go?" The sheet that opens when you press Go on a place: trek, keke, bus or your own car, with the price of each.
// Cars show a "Driver" choice when one is hired in the Hire app. Prices come from lib/travel.js; the server charges them again when you arrive.
// Each choice shows how long the trip will take: the road distance divided by the speed of what carries you, plus the walk to and from it (lib3d/tripplan.js).
"use client";
import { useLayoutEffect, useState } from "react";
import { Icon } from "./Icon";
import { naira } from "@/lib/client";
import { MODES, MODE_INFO, fareKobo } from "@/lib/travel.js";
import { canAfford } from "@/lib/gameStore";
import PlaceActivities from "./PlaceActivities";
import { featuresAt } from "@/lib/features.js";
import "./travel.css";

export default function TravelSheet({ place, here, hasCar, driver, people, distanceM = null, character = null, balanceKobo = null, jailed = false, highlight = null, eta = {}, onGo, onClose }) {
  // `place.blurb` is the short description of the building; it shows under the title so the sheet can replace the info card.
  const [mode, setMode] = useState("trek"), [withDriver, setWithDriver] = useState(true), [picked, setPicked] = useState(null);
  // the sheet docks on the bottom bar like the activities panel: the two read as one surface (components/bottom-nav.css)
  useLayoutEffect(() => { document.body.dataset.dock = "on"; return () => { delete document.body.dataset.dock; }; }, []);
  const fare = fareKobo(mode), poor = fare > 0n && !canAfford(fare), useDriver = mode === "car" && !!driver && withDriver;
  const { activities } = featuresAt(place.id, place.kind);
  // the estimate for a choice: "2 min 05 s" once worked out, "…" while it is being worked out, "No route" when the road does not reach there
  const key = (m) => (m === "car" && driver && withDriver ? "carDriver" : m), est = (m) => eta[key(m)];
  const reach = (m) => { const e = est(m); return e != null && !e.ok ? "No route" : ""; };
  const km = (m) => { const e = est(m); return e?.ok ? (e.len >= 1000 ? (e.len / 1000).toFixed(1) + " km" : Math.round(e.len) + " m") : ""; };
  const sub = (m) => (m === "car" && !hasCar ? "No car" : reach(m));
  const cur = est(mode), noRoute = cur != null && !cur.ok && mode !== "trek";
  const fareText = fare === 0n ? "Free" : naira(fare.toString());
  const away = [here ? `From ${here}` : "OAU campus", Number.isFinite(distanceM) ? `${distanceM} m` : null, people > 0 ? `${people} there now` : null].filter(Boolean).join(" · ");
  return (
    <div className="ts-scrim" onClick={onClose}>
      <div className="ts" role="dialog" aria-modal="true" aria-label={`Go to ${place.name}`} onClick={(e) => e.stopPropagation()}>
        <i className="ts-grab" aria-hidden="true" />
        <header className="ts-head">
          <span className="ts-ico"><Icon name="pin" size={20} weight="fill" /></span>
          <div><b>{place.name}</b><small>{away}</small></div>
          <button type="button" className="ghost ts-x" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </header>
        <div className="ts-scroll">
          {place.blurb && <p className="ts-blurb">{place.blurb}</p>}
          <PlaceActivities activities={activities} links={place.actions ?? []} character={character} balanceKobo={balanceKobo} jailed={jailed} highlight={highlight} picked={picked?.key ?? null} onPick={setPicked} />
          <div className="ts-modes" role="radiogroup" aria-label="How to travel">
            {MODES.map((m) => {
              const off = m === "car" && !hasCar, price = fareKobo(m);
              return (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className="ts-mode" data-on={mode === m ? "1" : undefined} disabled={off} onClick={() => setMode(m)}>
                  <Icon name={MODE_INFO[m].icon} size={24} weight="fill" />
                  <b>{MODE_INFO[m].name}</b>
                  <span className="num">{price === 0n ? "Free" : naira(price.toString())}</span>
                  {sub(m) && <small className="ts-time">{sub(m)}</small>}
                </button>
              );
            })}
          </div>
          {mode === "car" && hasCar && (
            driver ? (
              <label className="ts-driver"><input type="checkbox" checked={withDriver} onChange={(e) => setWithDriver(e.target.checked)} /><Icon name="driver" size={18} weight="fill" /> Let {driver.name} drive</label>
            ) : (
              <p className="ts-note">You steer, and a map shows the way. Hire a driver in the Hire app to be driven instead.</p>
            )
          )}
          {mode === "trek" && <p className="ts-note">On foot{km("trek") ? ` · ${km("trek")}` : ""}. A map shows the way, and you meet other players on the road.</p>}
          {(mode === "keke" || mode === "bus") && <p className="ts-note">The {MODE_INFO[mode].name.toLowerCase()} drops you at the nearest kerb, then you walk.{noRoute ? " No road reaches there, so trek instead." : ""} Fare is paid on arrival.</p>}
        </div>
        <footer className="ts-foot">
          <button type="button" className="go ts-go" disabled={poor || noRoute} data-sound="confirm" onClick={() => onGo(mode, useDriver, picked?.act ?? null)}>
            <Icon name="nav" size={20} weight="fill" /> {poor ? `You need ${naira(fare.toString())}` : noRoute ? "No route" : picked ? `Go and ${picked.label.toLowerCase()} · ${fareText}` : `Go · ${fareText}`}
          </button>
        </footer>
      </div>
    </div>
  );
}