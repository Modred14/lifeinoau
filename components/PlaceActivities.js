// components/PlaceActivities.js
// "What you can do here": every activity a building offers, read from the feature registry (lib/features.js), so a newly registered
// activity shows up here with no change to this file. Each row shows the name and a one-line summary; tapping it opens what it does,
// what it needs, what it gives (sure or not) and what it costs, with one button to go and start it.
// This only SHOWS the rules. The server still checks the player's position, energy, limits and money, and decides every reward.
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { blockedFor } from "@/lib/features.js";

function Row({ a, open, onToggle, blocked, here, actionLabel, onDo, flash }) {
  const ref = useRef(null);
  useEffect(() => { if (flash) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [flash]);
  return (
    <li ref={ref} className="pa-act" data-risk={a.risk} data-flash={flash ? "1" : undefined} data-blocked={blocked ? "1" : undefined}>
      <button type="button" className="pa-act-h" aria-expanded={open} onClick={onToggle}>
        <span className="pa-act-ico"><Icon name={a.icon ?? "sparkle"} size={18} weight="fill" /></span>
        <span className="pa-act-t"><b>{a.label}{a.risk === "risky" && <i className="pa-tag">Risky</i>}</b><small>{a.summary}</small></span>
        <Icon name={open ? "up" : "down"} size={14} />
      </button>
      {open && (
        <div className="pa-act-b">
          <p>{a.explain}</p>
          {a.requires.length > 0 && <div><b>Needs</b><ul>{a.requires.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {a.gives.length > 0 && <div data-tone="good"><b>{a.certainty === "variable" ? "Gives (not guaranteed)" : "Gives (sure)"}</b><ul>{a.gives.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {a.costs.length > 0 && <div data-tone={a.risk === "risky" ? "bad" : undefined}><b>Costs</b><ul>{a.costs.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {a.limits.length > 0 && <div><b>Limits</b><ul>{a.limits.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
        </div>
      )}
      {blocked && <p className="pa-act-why" role="note">{blocked}</p>}
      <button type="button" className={`go pa-act-go${a.risk === "risky" ? " risk" : ""}`} disabled={!!blocked && blocked.startsWith("You cannot do that while")} onClick={() => onDo(a)}>
        <Icon name={here ? "door" : "nav"} size={16} weight="fill" /> {actionLabel}
      </button>
    </li>
  );
}

/** `activities` from featuresAt(); `here` true when the player stands at this place; `onDo(activity)` goes (or goes in) and starts it. */
export default function PlaceActivities({ activities, extra = [], links = [], character, balanceKobo, jailed, here, actionLabel, onDo, highlight }) {
  const [open, setOpen] = useState(highlight ?? null);
  useEffect(() => { if (highlight) setOpen(highlight); }, [highlight]);
  if (!activities.length && !extra.length && !links.length) return <p className="pa-none">Nothing to do inside here. It is a place to visit or pass through.</p>;
  return (
    <section className="pa-acts" aria-label="What you can do here">
      <h3>What you can do here</h3>
      {activities.length > 0 && <ul>{activities.map((a) => (
        <Row key={a.key} a={a} open={open === a.act || open === a.key} flash={highlight === a.act}
          onToggle={() => setOpen((o) => (o === a.key ? null : a.key))} here={here} actionLabel={actionLabel}
          blocked={blockedFor(a, character, { jailed, balanceKobo })} onDo={onDo} />
      ))}</ul>}
      {extra.map((f) => <p key={f.id} className="pa-extra"><Icon name="sparkle" size={14} /> <b>{f.name}.</b> {f.summary}{f.status !== "live" && f.note ? ` (${f.note})` : ""}</p>)}
      {links.length > 0 && <div className="pa-links">{links.map((l) => <a key={l.href} className="btn" href={l.href}>{l.label}</a>)}</div>}
    </section>
  );
}
