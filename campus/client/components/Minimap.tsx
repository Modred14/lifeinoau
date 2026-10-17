"use client";

/** GTA-style corner minimap (north up). Tap it to open the full map. */
import { useEffect, useRef } from "react";
import type { CampusView } from "@campus/game/CampusView";
import { drawMinimap, renderMapBase } from "@campus/game/minimap";

const SIZE = 132; // canvas drawing size (css size is responsive, see .minimap canvas)
const VIEW_PX = 2600; // map pixels shown across the minimap (~130 m)
const BASE_SCALE = 0.03;

export default function Minimap({ view, onOpen }: { view: CampusView; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);
    const base = renderMapBase(BASE_SCALE);
    // 10 fps is plenty for a minimap and keeps it cheap.
    const id = window.setInterval(() => drawMinimap(g, base, BASE_SCALE, view.getRadar(), SIZE, VIEW_PX), 100);
    return () => window.clearInterval(id);
  }, [view]);

  return (
    <button className="minimap" onClick={onOpen} aria-label="Open map">
      <canvas ref={ref} />
      <span className="minimap-n" aria-hidden="true">N</span>
      <span className="minimap-caption" aria-hidden="true">Campus map</span>
    </button>
  );
}
