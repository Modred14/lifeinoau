"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function GamePanel({ children, className, label, onClose }: { children: ReactNode; className: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = ref.current;
    panel?.querySelector<HTMLElement>("button, input, [tabindex='0']")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  return (
    <div className="panel-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close.current(); }}>
      <section
        ref={ref}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); close.current(); }
          if (event.key !== "Tab") return;
          const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']") ?? [])];
          const first = items[0];
          const last = items.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && (document.activeElement === last || !first)) {
            event.preventDefault(); first?.focus();
          }
        }}
      >
        {children}
      </section>
    </div>
  );
}
