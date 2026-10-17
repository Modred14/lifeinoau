"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GistItem } from "@campuslife/shared";
import { PiMegaphoneSimpleDuotone } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import { GIST_COPY } from "./gist-copy";
import { GistPanel } from "./gist-panel";
import { useGist } from "./use-gist";
import "./gist.css";

const APP_ROOT = ".app";

export function GistChip({ view, onOpenChange }: { view: CampusView; onOpenChange?: (open: boolean) => void }) {
  const items = useGist(view);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const chip = useRef<HTMLButtonElement>(null);
  const top = items[0];
  const urgent = items.some((item) => item.act);

  const go = useCallback(
    (item: GistItem) => {
      if (!item.door) return;
      setOpen(false);
      view.goTo(item.door, item.where ?? item.title);
    },
    [view],
  );

  return (
    <>
      <button ref={chip} type="button" className={urgent ? "pill gist-chip gist-chip-act" : "pill gist-chip"} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={GIST_COPY.open(items.length)}>
        <PiMegaphoneSimpleDuotone aria-hidden="true" focusable="false" />
        <span className="gist-chip-text">
          <small>{GIST_COPY.name}</small>
          <b>{top ? top.title : GIST_COPY.empty}</b>
        </span>
        {items.length > 0 && (
          <span className="gist-count" aria-hidden="true">
            {items.length}
          </span>
        )}
      </button>
      {open && createPortal(<GistPanel items={items} onGo={go} onClose={() => setOpen(false)} />, chip.current?.closest(APP_ROOT) ?? document.body)}
    </>
  );
}
