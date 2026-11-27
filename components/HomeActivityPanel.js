// components/HomeActivityPanel.js
// The Home Activity Panel: everything the player can do at home, in categories (Rest and Sleep, Kitchen and Food, Bathroom and Hygiene, Personal Care, Relaxation, Other), shown as small cards.
// An activity whose fixture or furniture is not in the home is not shown at all (it appears when the player places it); one that is only blocked for now (tired, busy) stays, dimmed, with the reason. Starting one minimises the panel to a one-line status while it runs. The furniture itself can be tapped too (HomeWorld).
"use client";
import { useState } from "react";
import { Icon } from "./Icon";
import { CATEGORIES } from "@/lib/homeActivities.js";

/** list: lib/homeActivities listActivities(); act: { id, stage, left, private } | null; filter: activity ids to show (a tapped piece with several uses), or null. */
export default function HomeActivityPanel({ list, act, filter = null, open, onOpen, onClose, onStart, onStop }) {
  const [cat, setCat] = useState("all");
  if (act) {
    const def = list.find((a) => a.id === act.id), walking = act.stage === "walk";
    return (
      <div className="hap hap-run" role="status" aria-live="polite" data-private={act.private ? "1" : undefined}>
        <Icon name={def?.icon ?? "home"} size={18} />
        <span className="hap-run-t">{walking ? "Going to " + (def?.label ?? "it").toLowerCase() : (def?.doing ?? def?.label ?? "Doing it")}{!walking && act.stage === "active" && !act.sleep && act.left > 0 ? ` · ${act.left}s` : ""}</span>
        <button type="button" className="hap-stop" onClick={onStop}>{act.sleep && !walking ? "Wake up" : walking ? "Cancel" : "Stop"}</button>
      </div>
    );
  }
  if (!open) return null;
  const offered = list.filter((a) => a.present !== false), shown = offered.filter((a) => (!filter || filter.includes(a.id)) && (cat === "all" || a.cat === cat)), cats = CATEGORIES.filter((c) => offered.some((a) => a.cat === c.id && (!filter || filter.includes(a.id))));
  return (
    <section className="hap" role="dialog" aria-label="Home activities">
      <header className="hap-h"><b>At home</b><button type="button" className="hap-x" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button></header>
      {!filter && (
        <div className="hap-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={cat === "all"} onClick={() => setCat("all")}>All</button>
          {cats.map((c) => <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}><Icon name={c.icon} size={14} /> {c.label}</button>)}
        </div>
      )}
      <div className="hap-grid">
        {shown.map((a) => (
          <button key={a.id} type="button" className="hap-card" data-off={a.available ? undefined : "1"} aria-disabled={!a.available} title={a.available ? a.label : a.why} onClick={() => (a.available ? onStart(a.id) : onStart(a.id, a.why))}>
            <Icon name={a.icon} size={22} /><span className="hap-l">{a.label}</span>{!a.available && <span className="hap-w">{a.why}</span>}
          </button>
        ))}
        {!shown.length && <p className="hap-none">Nothing to do here yet. Place furniture with Buy to unlock activities.</p>}
      </div>
    </section>
  );
}
