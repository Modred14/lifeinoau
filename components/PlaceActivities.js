// components/PlaceActivities.js
// "What you can do here": every activity a building offers, read from the feature registry (lib/features.js), so a newly registered
// activity shows up here with no change to this file. Each activity is a collapsed row (name and a one-line summary). Opening it reveals
// ONE main button to go and start it, then, quieter beneath it, what it does, needs, gives and costs.
// This only SHOWS the rules. The server still checks the player's position, energy, limits and money, and decides every reward.
"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";
import { blockedFor } from "@/lib/features.js";

function Row({ a, open, onToggle, blocked, here, actionLabel, onDo, flash }) {
  const ref = useRef(null), bodyId = useId();
  useEffect(() => { if (flash) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [flash]);
  const hard = !!blocked && blocked.startsWith("You cannot do that while");
  const groups = [
    ["Needs", a.requires, null],
    [a.certainty === "variable" ? "Gives · not guaranteed" : "Gives · sure", a.gives, "good"],
    ["Costs", a.costs, a.risk === "risky" ? "bad" : null],
    ["Limits", a.limits, null],
  ].filter((g) => g[1].length > 0);
  return (
    <li ref={ref} className="pa-act" data-risk={a.risk} data-open={open ? "1" : undefined} data-flash={flash ? "1" : undefined} data-blocked={blocked ? "1" : undefined}>
      <button type="button" className="pa-act-h" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} data-sound="none">
        <span className="pa-act-ico"><Icon name={a.icon ?? "sparkle"} size={18} weight="fill" /></span>
        <span className="pa-act-t">
          <b>{a.label}{a.risk === "risky" && <i className="pa-tag">Risky</i>}{blocked && <i className="pa-tag" data-k="wait">Not now</i>}</b>
          <small>{a.summary}</small>
        </span>
        <span className="pa-chev" aria-hidden="true"><Icon name="down" size={16} /></span>
      </button>
      {open && (
        <div className="pa-act-b" id={bodyId}>
          {blocked && <p className="pa-act-why" role="note">{blocked}</p>}
          <button type="button" className={`go pa-act-go${a.risk === "risky" ? " risk" : ""}`} disabled={hard} onClick={() => onDo(a)}>
            <Icon name={here ? "door" : "nav"} size={18} weight="fill" /> {actionLabel}
          </button>
          {a.explain && <p className="pa-act-ex">{a.explain}</p>}
          {groups.length > 0 && (
            <div className="pa-det">
              {groups.map(([title, list, tone]) => (
                <div key={title} className="pa-grp" data-tone={tone ?? undefined}><b>{title}</b><ul>{list.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** `activities` from featuresAt(); `here` true when the player stands at this place; `onDo(activity)` goes (or goes in) and starts it. */
export default function PlaceActivities({ activities, extra = [], links = [], character, balanceKobo, jailed, here, actionLabel, onDo, highlight }) {
  const [open, setOpen] = useState(highlight ?? null);
  useEffect(() => { if (highlight) setOpen(highlight); }, [highlight]);
  if (!activities.length && !extra.length && !links.length) return <p className="pa-none">Nothing to do inside. Just visiting or passing through.</p>;
  return (
    <section className="pa-acts" aria-label="What you can do here">
      <h3 className="pa-lab">Activities</h3>
      {activities.length > 0 && <ul className="pa-list">{activities.map((a) => (
        <Row key={a.key} a={a} open={open === a.act || open === a.key} flash={highlight === a.act}
          onToggle={() => setOpen((o) => (o === a.key || o === a.act ? null : a.key))} here={here} actionLabel={actionLabel}
          blocked={blockedFor(a, character, { jailed, balanceKobo })} onDo={onDo} />
      ))}</ul>}
      {extra.map((f) => <p key={f.id} className="pa-extra"><Icon name="sparkle" size={14} /> <b>{f.name}.</b> {f.summary}{f.status !== "live" && f.note ? ` (${f.note})` : ""}</p>)}
      {links.length > 0 && <div className="pa-links">{links.map((l) => <a key={l.href} className="btn" href={l.href}>{l.label}</a>)}</div>}
    </section>
  );
}