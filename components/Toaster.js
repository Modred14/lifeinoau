// components/Toaster.js
"use client";
import "./toaster.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react";
import { getServerSnapshot, getSnapshot, subscribe, toast } from "@/lib/toast";

const ICONS = { success: CheckCircle, error: WarningCircle, info: Info };

function Item({ t }) {
  const Glyph = ICONS[t.type] ?? Info;
  const remaining = useRef(0),
    startedAt = useRef(0),
    timer = useRef(0),
    holds = useRef({ hover: false, focus: false });
  const [paused, setPaused] = useState(false);

  // Auto-dismiss timer. Restarts when the same toast is refreshed (t.stamp). Always cleared on unmount.
  useEffect(() => {
    remaining.current = t.duration ?? 0;
    if (t.duration == null) return undefined;
    const h = holds.current;
    if (!h.hover && !h.focus) {
      startedAt.current = Date.now();
      timer.current = window.setTimeout(
        () => toast.dismiss(t.id),
        remaining.current,
      );
    }
    return () => window.clearTimeout(timer.current);
  }, [t.id, t.stamp, t.duration]);

  // Hovering or focusing a toast pauses its countdown so it can be read and acted on.
  const setHold = (kind, on) => {
    const h = holds.current;
    if (h[kind] === on) return;
    h[kind] = on;
    if (t.duration == null) return;
    const hold = h.hover || h.focus;
    if (hold) {
      window.clearTimeout(timer.current);
      remaining.current = Math.max(
        800,
        remaining.current - (Date.now() - startedAt.current),
      );
    } else {
      startedAt.current = Date.now();
      timer.current = window.setTimeout(
        () => toast.dismiss(t.id),
        remaining.current,
      );
    }
    setPaused(hold);
  };

  return (
    <li className="tt-slot" data-state={t.state}>
      <div className="tt-clip">
        <div
          className="tt"
          data-type={t.type}
          onPointerEnter={() => setHold("hover", true)}
          onPointerLeave={() => setHold("hover", false)}
          onFocus={() => setHold("focus", true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
              setHold("focus", false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              toast.dismiss(t.id);
            }
          }}
        >
          <span className="tt-icon" aria-hidden="true">
            <Glyph size={22} weight="fill" />
          </span>
          <div className="tt-body">
            <p className="tt-msg">
              {t.message}
              {t.count > 1 && (
                <span className="tt-count" aria-hidden="true">
                  ×{t.count}
                </span>
              )}
            </p>
            {t.action && (
              <button
                type="button"
                className="tt-action"
                onClick={() => {
                  try {
                    t.action.onClick?.();
                  } finally {
                    toast.dismiss(t.id);
                  }
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            className="tt-close"
            aria-label="Dismiss notification"
            onClick={() => toast.dismiss(t.id)}
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
          {t.duration != null && (
            <span
              key={t.stamp}
              className="tt-bar"
              aria-hidden="true"
              data-paused={paused || undefined}
              style={{ animationDuration: `${t.duration}ms` }}
            />
          )}
        </div>
      </div>
    </li>
  );
}

export default function Toaster() {
  const toasts = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const politeRef = useRef(null),
    assertiveRef = useRef(null),
    seen = useRef(new Map()),
    timers = useRef([]);

  // Screen-reader announcements go through two always-present live regions (polite for success/info,
  // assertive for errors). The visible toasts themselves are not live, so nothing is read twice.
  useEffect(() => {
    const polite = [],
      assertive = [];
    for (const t of toasts) {
      if (t.state === "out" || seen.current.get(t.id) === t.stamp) continue;
      seen.current.set(t.id, t.stamp);
      (t.type === "error" ? assertive : polite).push(t.message);
    }
    for (const id of [...seen.current.keys()])
      if (!toasts.some((t) => t.id === id)) seen.current.delete(id);
    const speak = (node, lines) => {
      if (!node || !lines.length) return;
      node.textContent = ""; // clear first so an identical repeated message is announced again
      timers.current.push(
        window.setTimeout(() => {
          node.textContent = lines.join(". ");
        }, 60),
      );
    };
    speak(politeRef.current, polite);
    speak(assertiveRef.current, assertive);
  }, [toasts]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  return (
    <>
      <section className="tt-region" aria-label="Notifications">
        <ol className="tt-list">
          {toasts.map((t) => (
            <Item key={t.id} t={t} />
          ))}
        </ol>
      </section>
      <div
        className="tt-sr"
        ref={politeRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
      <div
        className="tt-sr"
        ref={assertiveRef}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      />
    </>
  );
}
