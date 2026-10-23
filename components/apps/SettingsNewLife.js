// components/apps/SettingsNewLife.js: the "Start a new life" confirmation, a bottom sheet inside the phone.
// Nothing is reset by opening this. The sheet first asks the server whether a new life can start right now (a sentence in custody, a running match, an election...
// stand in the way and are listed), then says plainly what will be deleted and what stays. The reset only goes ahead when the player ticks the box AND types their password;
// the server checks the password and the confirmation token again (lib/newLifeService.js), and does everything in one database transaction.
"use client";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { call, loggedOut } from "@/lib/client";
import { NEW_LIFE_CONFIRM, NEW_LIFE_LOSES, NEW_LIFE_KEEPS } from "@/lib/newLifeRules";
import { Sheet, Status } from "./settingsKit";

export default function NewLifeSheet({ name, onClose, onDone, router }) {
  const [check, setCheck] = useState(null); // null = asking the server, { blockers } = answered, { error } = could not ask
  const [ack, setAck] = useState(false), [pw, setPw] = useState(""), [status, setStatus] = useState(null), [busy, setBusy] = useState(false);

  async function ask() {
    setCheck(null);
    const r = await call("/api/settings", { action: "newLifeCheck" });
    if (r.status === 401) return loggedOut(router);
    setCheck(r.failed ? { error: r.error || "We could not check your game. Check your connection and try again." } : { blockers: r.blockers ?? [] });
  }
  useEffect(() => { ask(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function go(e) {
    e.preventDefault();
    if (!ack || !pw || busy || check?.blockers?.length) return; // never without the tick and the password
    setBusy(true); setStatus({ kind: "busy", text: "Starting your new life…" });
    const r = await call("/api/settings", { action: "newLife", password: pw, confirm: NEW_LIFE_CONFIRM });
    if (r.status === 401) { setBusy(false); return loggedOut(router); }
    if (r.failed) { setBusy(false); setPw(""); return setStatus({ kind: "error", text: r.error || "Nothing was changed. Check your connection and try again." }); }
    onDone();
  }

  const blocked = !!check?.blockers?.length, ready = check && !check.error && !blocked;
  return (
    <Sheet title="Start a new life?" onClose={onClose} busy={busy}>
      <p className="st-sheetlead">{name ? <><b>{name}</b> will be deleted and you will create a brand new character.</> : "Your character will be deleted and you will create a brand new one."} This cannot be undone.</p>
      {!check && <p className="st-muted" role="status">Checking your game…</p>}
      {check?.error && <div className="st-retry"><p role="alert">{check.error}</p><button type="button" onClick={ask}>Try again</button></div>}
      {blocked && (
        <div className="st-block" role="alert"><b><Icon name="alert" size={16} weight="fill" /> Not right now</b>
          <ul>{check.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <button type="button" onClick={ask}>Check again</button>
        </div>
      )}
      {ready && (
        <form onSubmit={go}>
          <div className="st-lists">
            <div><h4 className="st-lose"><Icon name="trash" size={15} weight="fill" /> This will be deleted</h4><ul>{NEW_LIFE_LOSES.map((t) => <li key={t}>{t}</li>)}</ul></div>
            <div><h4 className="st-keep"><Icon name="shield" size={15} weight="fill" /> This stays</h4><ul>{NEW_LIFE_KEEPS.map((t) => <li key={t}>{t}</li>)}</ul></div>
          </div>
          <label className="st-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} /> <span>I understand my current life will be deleted for good.</span></label>
          <label className="st-label" htmlFor="st-lifepw">Your password</label>
          <input id="st-lifepw" type="password" autoComplete="current-password" value={pw} disabled={busy} onChange={(e) => { setPw(e.target.value); setStatus(null); }} placeholder="Type your password to confirm" />
          <Status s={status} />
          <div className="st-btns">
            <button type="button" className="st-first" disabled={busy} onClick={onClose}>Keep my life</button>
            <button type="submit" className="danger" disabled={!ack || !pw || busy}>{busy ? "Working…" : "Delete and start over"}</button>
          </div>
        </form>
      )}
      {!ready && !busy && <div className="st-btns"><button type="button" className="st-first" onClick={onClose}>Close</button></div>}
    </Sheet>
  );
}
