"use client";

import { GIST_KIND_LABEL, type GistItem } from "@campuslife/shared";
import { PiMegaphoneSimpleDuotone, PiXDuotone } from "react-icons/pi";
import { GamePanel } from "../GamePanel";
import { GIST_COPY, gistWhen } from "./gist-copy";
import { GistIcon } from "./gist-icon";

export function GistPanel({ items, onGo, onClose }: { items: readonly GistItem[]; onGo: (item: GistItem) => void; onClose: () => void }) {
  return (
    <GamePanel className="sheet jobs gist-sheet" label={GIST_COPY.name} onClose={onClose}>
      <div className="jobs-head">
        <h2>
          <PiMegaphoneSimpleDuotone aria-hidden="true" focusable="false" />
          {GIST_COPY.name}
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <PiXDuotone aria-hidden="true" focusable="false" />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="jobs-bg">{GIST_COPY.emptyNote}</p>
      ) : (
        <ul className="jobs-list">
          {items.map((item) => (
            <li key={item.id} className={item.act ? "job gist-row gist-row-act" : "job gist-row"}>
              <span className="job-icon" aria-hidden>
                <GistIcon kind={item.kind} />
              </span>
              <div className="job-body">
                <span className={item.live ? "gist-tag gist-tag-live" : "gist-tag"}>
                  {GIST_KIND_LABEL[item.kind]} · {gistWhen(item)}
                </span>
                <b>{item.title}</b>
                <small>{item.detail}</small>
              </div>
              {item.door && (
                <button type="button" className="btn job-go gist-go" onClick={() => onGo(item)} aria-label={GIST_COPY.goTo(item.title)}>
                  {GIST_COPY.go}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="jobs-foot">{GIST_COPY.foot}</p>
    </GamePanel>
  );
}
