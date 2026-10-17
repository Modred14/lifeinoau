"use client";

/**
 * Character creator (Bitmoji / Sims style): body, hair, top, bottoms, shoes,
 * skin tone and colours, with a live 3D preview. Used before entering
 * campus and from the in-game Wardrobe button.
 */
import dynamic from "next/dynamic";
import { STORAGE_KEYS } from "@campus/lib/storage";
import { Brand } from "./Brand";
import { GameIcon } from "./GameIcon";
import { useStudioThumbnails } from "./useStudioThumbnails";
import { WardrobeOptions } from "./wardrobe/WardrobeOptions";
import { WardrobeTabs } from "./wardrobe/WardrobeTabs";
import { useWardrobe } from "./wardrobe/useWardrobe";
import "./wardrobe.css";
import "./studio-premium.css";
import { decodeLook, encodeLook, randomLook } from "@campuslife/shared/avatar";

const AvatarPreview = dynamic(() => import("./StudioViewport"), {
  ssr: false,
  loading: () => <div className="preview-3d preview-loading">Loading 3D…</div>,
});

export const LOOK_STORAGE_KEY = STORAGE_KEYS.look;

export function loadSavedLook(): string {
  try {
    const saved = localStorage.getItem(LOOK_STORAGE_KEY);
    if (saved) return encodeLook(decodeLook(saved));
  } catch {
    /* storage unavailable */
  }
  return encodeLook(randomLook());
}

interface Props {
  initialLook: string;
  title: string;
  confirmLabel: string;
  onConfirm: (look: string) => void;
  onCancel?: () => void;
}

export function AvatarCreator({ initialLook, title, confirmLabel, onConfirm, onCancel }: Props) {
  const state = useWardrobe(initialLook);
  const { encoded, tab, turn, setTurn, shuffle, reset, selectedOutfit, topLabel, shoesLabel } = state;
  const thumbnails = useStudioThumbnails(state.thumbnailRequests);

  const confirm = () => {
    try {
      localStorage.setItem(LOOK_STORAGE_KEY, encoded);
    } catch {
      /* ignore */
    }
    onConfirm(encoded);
  };

  return (
    <div className="creator wardrobe">
      <header className="wardrobe-header">
        <div className="creator-identity"><Brand compact /><h2>{title}</h2></div>
        {onCancel && <button className="icon-btn" onClick={onCancel} aria-label="Close wardrobe"><GameIcon name="close" /></button>}
      </header>
      <div className="creator-preview wardrobe-stage">
        <div className="wardrobe-stage-light" aria-hidden="true" />
        <AvatarPreview look={encoded} focus={tab === "shoes" ? "shoes" : tab === "hair" ? "hair" : "full"} turn={turn} />
        <div className="wardrobe-preview-tools">
          <button className="icon-btn" onClick={() => setTurn((value) => value - 1)} aria-label="Turn student left"><GameIcon name="turnLeft" /></button>
          <button className="icon-btn" onClick={() => setTurn((value) => value + 1)} aria-label="Turn student right"><GameIcon name="turnRight" /></button>
          <button className="wardrobe-shuffle" onClick={shuffle}><GameIcon name="dice" />Shuffle</button>
        </div>
        <div className="wardrobe-equipped">
          <strong aria-live="polite">{selectedOutfit?.label ?? "Your campus look"}</strong>
          <span>{topLabel}<span aria-hidden="true"> · </span>{shoesLabel}</span>
        </div>
        <p className="creator-spin"><GameIcon name="compass" />Drag to turn</p>
      </div>

      <div className="creator-panel">
        <WardrobeTabs value={tab} onChange={state.setTab} />
        <WardrobeOptions state={state} thumbnails={thumbnails} />

        <div className="creator-actions">
          <button className="wardrobe-reset" onClick={reset} aria-label="Reset changes" title="Reset changes"><GameIcon name="back" /></button>
          {onCancel && <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
          <button className="btn wardrobe-save" onClick={confirm}>{confirmLabel}<GameIcon name="check" /></button>
        </div>
      </div>
    </div>
  );
}
