// components/NeedsSheet.js
// The sheet that opens when you tap your avatar on the bottom bar: who you are, how you are doing (the needs bars and one line about the worst of them),
// and shortcuts into the phone apps that hold the rest of you (profile, academics, career, love). It is drawn by BottomNav, just above the bar, and closes
// on the X, on Escape, on a tap anywhere outside it, and whenever the phone opens. The numbers come from the game state the whole app shares; nothing here is stored.
"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import PlayerAvatar from "./PlayerAvatar";
import { NEEDS, moodOf, statusOf, toneOf } from "@/lib/needs.js";
import "./needs-sheet.css";

// [label, phone app id, Icon name]: the "tabs" of the sheet. Needs is the page you are on; the others open that app in the phone.
const SHORTCUTS = [
  ["Profile", "settings", "gear"],
  ["Academics", "portal", "library"],
  ["Career", "jobs", "jobs"],
  ["Love", "love", "love"],
];

export default function NeedsSheet({ character, onClose, id }) {
  const box = useRef(null), c = character ?? {}, mood = moodOf(c), status = statusOf(c);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    // a tap anywhere else closes the sheet but is not swallowed (the game or the bar still gets it); Escape closes this before anything behind it
    const down = (e) => { if (!box.current?.contains(e.target) && !e.target.closest?.(".nav-me")) onClose(); };
    const key = (e) => { if (e.key !== "Escape") return; e.stopPropagation(); e.preventDefault(); onClose(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [onClose]);
  const openApp = (app) => { onClose(); window.dispatchEvent(new CustomEvent("oau:phone-app", { detail: { app } })); }; // Shell opens the phone on that app
  return (
    <section ref={box} id={id} className="ns" role="dialog" aria-label="You: needs and feelings" tabIndex={-1}>
      <i className="ns-grab" aria-hidden="true" />
      <header className="ns-h">
        <PlayerAvatar name={c.name} size={48} />
        <div className="ns-who">
          <b>{c.name}</b>
          <span data-tone={mood.tone}><Icon name={mood.icon} size={14} weight="fill" /> {mood.text}</span>
        </div>
        <button type="button" className="ns-x" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
      </header>
      <div className="ns-tabs" role="group" aria-label="Your pages">
        {SHORTCUTS.slice(0, 1).map(([n, app, ic]) => <button key={app} type="button" onClick={() => openApp(app)}><Icon name={ic} size={15} /> {n}</button>)}
        <button type="button" aria-pressed="true" className="on">Needs</button>
        {SHORTCUTS.slice(1).map(([n, app, ic]) => <button key={app} type="button" onClick={() => openApp(app)}><Icon name={ic} size={15} /> {n}</button>)}
      </div>
      <ul className="ns-list">
        {NEEDS.map(([label, key, icon]) => {
          const v = Math.max(0, Math.min(100, Math.round(Number(c[key] ?? 0))));
          return (
            <li key={key} data-tone={toneOf(key, v)} data-k={key}>
              <span className="ns-ico" aria-hidden="true"><Icon name={icon} size={18} /></span>
              <div className="ns-row">
                <div className="ns-line"><span>{label}</span><b className="num">{v}</b></div>
                <div className="ns-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}><i style={{ width: v + "%" }} /></div>
              </div>
            </li>
          );
        })}
      </ul>
      <h3 className="ns-sub">How you are</h3>
      <div className="ns-feel" data-tone={status?.tone ?? "ok"}>
        <span className="ns-ico" aria-hidden="true"><Icon name={status ? "warn" : mood.icon} size={18} /></span>
        <p>{status ? status.text : "You are doing fine. Keep it up."}</p>
      </div>
    </section>
  );
}
