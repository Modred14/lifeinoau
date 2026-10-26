// components/PlaceActivities.js
// "What you can do here" as small chips: icon + name, nothing else. Only what the player can do right now is shown (a blocked one is left out, not
// explained). Tapping a chip picks it (tap again to un-pick): the sheet's main button then says "Go and <activity>". Risky ones are tinted, not confirmed.
// This only SHOWS the choice. The server still checks the player's position, energy, limits and money, and decides every reward.
"use client";
import { useEffect } from "react";
import { Icon } from "./Icon";
import { blockedFor } from "@/lib/features.js";

/** `activities` from featuresAt(); `picked` the chosen activity's key (or null); `onPick(activity | null)`. */
export default function PlaceActivities({ activities = [], links = [], character, balanceKobo, jailed, highlight = null, picked = null, onPick }) {
  const doable = activities.filter((a) => !blockedFor(a, character, { jailed, balanceKobo }));
  useEffect(() => { if (highlight && !picked) { const a = doable.find((x) => x.act === highlight || x.key === highlight); if (a) onPick?.(a); } }, [highlight]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doable.length && !links.length) return null;
  return (
    <section className="pa-acts" aria-label="What you can do here">
      <h3 className="pa-lab">Activities</h3>
      <div className="pa-chips" role="group" aria-label="Pick an activity to do when you get there">
        {doable.map((a) => (
          <button key={a.key} type="button" className="pa-chip" aria-pressed={picked === a.key} data-risk={a.risk} onClick={() => onPick?.(picked === a.key ? null : a)} data-sound="none">
            <Icon name={a.icon ?? "sparkle"} size={15} weight="fill" /> {a.label}
          </button>
        ))}
        {links.map((l) => <a key={l.href} className="pa-chip" href={l.href}>{l.label}</a>)}
      </div>
    </section>
  );
}