// components/ConfirmDialog.js
"use client";
import "./confirm-dialog.css";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Warning, ShieldCheck, Check } from "@phosphor-icons/react";
import { getServerSnapshot, getSnapshot, settle, subscribe } from "@/lib/confirm";

const EXIT_MS = 160;
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function Dialog({ req }) {
  const uid = useId();
  const [text, setText] = useState(req.input?.initial ?? "");
  const [acked, setAcked] = useState(false);
  const [closing, setClosing] = useState(false);
  const root = useRef(null), field = useRef(null), cancelBtn = useRef(null), done = useRef(false), timer = useRef(0);
  const danger = req.tone === "danger", Glyph = danger ? Warning : ShieldCheck;
  const needsText = !!req.input, needsAck = !!req.ack;
  const textOk = !needsText || !req.input.required || text.trim().length > 0;
  const canConfirm = textOk && (!needsAck || acked);

  const finish = useCallback((ok) => {
    if (done.current) return;
    done.current = true; setClosing(true);
    timer.current = window.setTimeout(() => settle(req.id, { ok, value: ok ? text : "" }), EXIT_MS);
  }, [req.id, text]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Lock scroll, move focus in (the text box if there is one, otherwise the safe "cancel" button), give focus back on close.
  useEffect(() => {
    const opener = document.activeElement, prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (field.current ?? cancelBtn.current)?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = prev; if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({ preventScroll: true }); };
  }, []);

  // Esc cancels, Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); return; }
      if (e.key !== "Tab" || !root.current) return;
      const items = [...root.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (!root.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [finish]);

  const submit = (e) => { e.preventDefault(); if (canConfirm) finish(true); };
  const multiline = !!req.input?.multiline;

  return (
    <div className="cd-scrim" data-closing={closing || undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) finish(false); }}>
      <form ref={root} className="cd" data-tone={req.tone} role={danger ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`${uid}-t`} aria-describedby={req.message ? `${uid}-m` : undefined} onSubmit={submit} noValidate>
        <span className="cd-icon" aria-hidden="true"><Glyph size={26} weight="fill" /></span>
        <h2 id={`${uid}-t`} className="cd-title">{req.title ?? "Are you sure?"}</h2>
        {req.message && <p id={`${uid}-m`} className="cd-msg">{req.message}</p>}

        {needsText && (
          <div className="cd-field">
            <label htmlFor={`${uid}-i`}>{req.input.label}{req.input.required && <span className="cd-req"> (required)</span>}</label>
            {multiline
              ? <textarea id={`${uid}-i`} ref={field} rows={3} maxLength={req.input.maxLength ?? 500} placeholder={req.input.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
              : <input id={`${uid}-i`} ref={field} type="text" maxLength={req.input.maxLength ?? 200} placeholder={req.input.placeholder} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />}
          </div>
        )}

        {needsAck && (
          <label className="cd-ack">
            <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
            <span className="cd-box" aria-hidden="true"><Check size={14} weight="bold" /></span>
            <span>{req.ack}</span>
          </label>
        )}

        <div className="cd-actions">
          <button type="button" ref={cancelBtn} className="cd-cancel" onClick={() => finish(false)}>{req.cancelLabel}</button>
          <button type="submit" className="cd-ok" data-tone={req.tone} disabled={!canConfirm}>{req.confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

export default function ConfirmDialog() {
  const req = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return req ? <Dialog key={req.id} req={req} /> : null;
}