// components/apps/settingsKit.js
// The small pieces the Settings app (components/apps/SettingsApp.js) is built from, and the one way a preference gets saved.
// Everything here is drawn with the phone's own light page styles (components/phone.css, settings-app.css): grouped rows, switches, bottom sheets.
"use client";
import { useEffect, useRef } from "react";
import { Icon } from "../Icon";
import { call } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game } from "@/lib/gameStore";
import { createSerial } from "@/lib/optimistic";
import { applyPrefs, getPrefs } from "@/lib/prefs";
import { cleanSettings } from "@/lib/settings";

/* ---------------------------------- saving a preference ---------------------------------- */

const queue = createSerial(); // saves go to the server one after another, so the last tap is the one that wins
const waiting = new Map(); // "group.key" -> { timer, before, op, value }

/** Change one preference: it takes effect everywhere AT ONCE (music, sound effects, name tags, the controls...), then it is saved to the player's account.
 *  If the server refuses, the change is taken back and the player is told. `delay` is for sliders: one save after the last movement, not one per pixel.
 *  This lives outside any component on purpose: closing the phone straight after a tap must not lose the save. */
export function savePref(group, key, value, { delay = 0, onAuth } = {}) {
  const id = group + "." + key, prev = getPrefs(), w = waiting.get(id);
  if (prev[group][key] === value && !w) return;
  const next = cleanSettings({ [group]: { [key]: value } }, prev);
  applyPrefs(next); // live in this browser right now
  const op = game.push((s) => (s ? { ...s, character: { ...s.character, settings: next } } : s)); // and in the game state, so a refresh in flight cannot flip it back
  if (w) { clearTimeout(w.timer); game.rollback(w.op); } // a newer tap replaces an older one that was still waiting to be sent
  const entry = { before: w ? w.before : prev[group][key], op, value, timer: null };
  waiting.set(id, entry);
  const send = () => {
    waiting.delete(id);
    queue.run(async () => {
      const r = await call("/api/settings", { action: "preferences", settings: { [group]: { [key]: entry.value } } });
      if (r.status === 401) { game.rollback(entry.op); onAuth?.(); return; }
      if (r.failed) {
        game.rollback(entry.op);
        applyPrefs(cleanSettings({ [group]: { [key]: entry.before } }, getPrefs())); // taken back: it was not saved
        toast.error(r.error || "That setting could not be saved. Check your connection and try again.", { id: "pref-save" });
        return;
      }
      game.done(entry.op);
    });
  };
  if (delay > 0) entry.timer = setTimeout(send, delay); else send();
}

/* ---------------------------------- layout pieces ---------------------------------- */

/** A group of rows on a rounded card, with an optional small heading above and a note below. */
export function Group({ title, foot, children, tone }) {
  return (
    <section className="st-sec" data-tone={tone}>
      {title && <h3 className="st-h">{title}</h3>}
      <div className="st-group">{children}</div>
      {foot && <p className="st-foot">{foot}</p>}
    </section>
  );
}

/** The coloured icon tile at the start of a row. */
export const Tile = ({ icon, tone = "graphite" }) => (
  <span className="ph-ico st-ico" data-tone={tone} aria-hidden="true"><Icon name={icon} size={20} weight="fill" /></span>
);

/** A row that opens a page (or does something). `value` is a short current state shown at the end. */
export function NavRow({ icon, tone, title, sub, value, onClick, danger, disabled, badge, ...rest }) {
  return (
    <button type="button" className="st-row st-nav" data-danger={danger ? "1" : undefined} disabled={disabled} onClick={onClick} {...rest}>
      {icon && <Tile icon={icon} tone={tone} />}
      <span className="st-txt"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {badge && <i className="st-badge">{badge}</i>}
      {value && <em className="st-val">{value}</em>}
      <span className="st-chev" aria-hidden="true"><Icon name="caret" size={16} weight="bold" /></span>
    </button>
  );
}

/** A row that only shows a fact. `lock` marks what the game decides and the player cannot edit. */
export function InfoRow({ title, value, lock }) {
  return (
    <div className="st-row st-info">
      <span className="st-txt"><b>{title}</b></span>
      <em className="st-val st-val-long">{value}</em>
      {lock && <span className="st-lock" title="Set by the game"><Icon name="lockS" size={13} weight="fill" label="Set by the game" /></span>}
    </div>
  );
}

/** An on/off switch row: a real checkbox with role="switch", so keyboards and screen readers work. */
export function ToggleRow({ icon, tone, title, sub, checked, onChange, disabled }) {
  return (
    <label className="st-row" data-disabled={disabled ? "1" : undefined}>
      {icon && <Tile icon={icon} tone={tone} />}
      <span className="st-txt"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      <input type="checkbox" role="switch" className="st-in" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="st-track" aria-hidden="true" />
    </label>
  );
}

/** Two or three choices side by side. */
export function Segmented({ label, value, options, onPick, disabled }) {
  return (
    <div className="st-seg" role="group" aria-label={label}>
      {options.map(([k, name]) => <button key={k} type="button" aria-pressed={value === k} disabled={disabled} onClick={() => onPick(k)}>{name}</button>)}
    </div>
  );
}

/** A message under a form: busy / ok / error. */
export const Status = ({ s }) => (s ? <p className="st-status" data-kind={s.kind} role={s.kind === "error" ? "alert" : "status"}>{s.text}</p> : null);

/** A small notice with an icon. */
export const Note = ({ icon = "alert", children }) => <p className="st-note" role="note"><Icon name={icon} size={15} weight="fill" /><span>{children}</span></p>;

/** A bottom sheet that slides up inside the handset (the same sheet the other phone apps use). Esc and a tap outside close it (the app handles Esc). */
export function Sheet({ title, onClose, children, busy }) {
  const box = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    box.current?.querySelector("input:not([type=checkbox]), textarea, button.st-first")?.focus({ preventScroll: true });
    return () => { if (before && document.contains(before)) before.focus?.({ preventScroll: true }); };
  }, []);
  return (
    <div className="ph-sheet-scrim" data-sound="close" onClick={busy ? undefined : onClose}>
      <div className="ph-sheet st-sheet" ref={box} role="dialog" aria-modal="true" aria-label={title} data-sound="none" onClick={(e) => e.stopPropagation()}>
        <span className="ph-grab" aria-hidden="true" />
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
