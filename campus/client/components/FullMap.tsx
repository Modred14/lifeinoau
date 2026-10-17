"use client";

/**
 * Full-screen campus map (real OAU layout from OpenStreetMap). Search a place
 * or tap the map; then walk there along the roads, or pick one of the rides
 * your school allows.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BUILDINGS, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, pointInPoly, type Place, type Point } from "@campuslife/shared";
import { VENDORS, type Vendor } from "@campuslife/shared/market";
import type { CampusView, TravelOption } from "@campus/game/CampusView";
import { drawFullMap, fullMapFit, isMajorPlace, renderMapBase, type MapCamera, type MapPin } from "@campus/game/minimap";
import { GameIcon } from "./GameIcon";
import { GamePanel } from "./GamePanel";
import { VENDOR_COLOR } from "./market/colors";
import { TravelOptions } from "./TravelOptions";

const BASE_SCALE = 0.05;
const ZOOM_MIN = 1;
const ZOOM_MAX = 10;
const ZOOM_STEP = 1.6;
const LOCATE_ZOOM = 4;
const WHEEL_ZOOM = 0.0015;
const WHEEL_PINCH_ZOOM = 0.012;
const WHEEL_MAX_STEP = 120;
const DRAG_THRESHOLD = 8;
const IDLE_FRAME_MS = 66;
const UNNAMED_PLACE = "there";
const TAP_RADIUS_PX = 18;
const COPY = {
  buy: "Where to buy",
  buyList: "All places and my orders",
  buyClose: "Back to the map",
  buyLabel: "Places to buy from",
  noVendor: "No shop matches",
  noPlace: "No place matches",
};

const MarketFlow = dynamic(() => import("./market/market-flow").then((m) => m.MarketFlow), { ssr: false });

type PinnedVendor = Vendor & { point: Point };
const PINNED_VENDORS = VENDORS.filter((v): v is PinnedVendor => v.point !== null);
const VENDOR_PINS: readonly MapPin[] = PINNED_VENDORS.map((v) => ({ point: v.point, color: VENDOR_COLOR[v.category], label: v.name }));

interface MapPointer {
  x: number;
  y: number;
  moved: number;
}

function clampCamera(cam: MapCamera, w: number, h: number) {
  cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom));
  const k = fullMapFit(w, h) * cam.zoom;
  const halfW = w / 2 / k;
  const halfH = h / 2 / k;
  cam.cx = halfW * 2 >= MAP_WIDTH_PX ? MAP_WIDTH_PX / 2 : Math.min(MAP_WIDTH_PX - halfW, Math.max(halfW, cam.cx));
  cam.cy = halfH * 2 >= MAP_HEIGHT_PX ? MAP_HEIGHT_PX / 2 : Math.min(MAP_HEIGHT_PX - halfH, Math.max(halfH, cam.cy));
}

export default function FullMap({ view, onClose }: { view: CampusView; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const transform = useRef({ k: 1, ox: 0, oy: 0 });
  const cam = useRef<MapCamera>({ zoom: ZOOM_MIN, cx: MAP_WIDTH_PX / 2, cy: MAP_HEIGHT_PX / 2 });
  const pointers = useRef(new Map<number, MapPointer>());
  const pinch = useRef({ distance: 0, multi: false });
  const dirty = useRef(true);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<{ target: Point; name: string; options: TravelOption[] } | null>(null);
  const [buying, setBuying] = useState(false);
  const [market, setMarket] = useState<{ vendorId?: string } | null>(null);
  const pins = useRef<readonly MapPin[]>([]);
  pins.current = buying ? VENDOR_PINS : [];

  useEffect(() => {
    const canvas = ref.current!;
    const base = renderMapBase(BASE_SCALE);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!dirty.current && now - last < IDLE_FRAME_MS) return;
      dirty.current = false;
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      clampCamera(cam.current, w, h);
      transform.current = drawFullMap(g, base, view.getRadar(), w, h, cam.current, pins.current);
    };
    raf = requestAnimationFrame(draw);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const step = Math.min(WHEEL_MAX_STEP, Math.max(-WHEEL_MAX_STEP, e.deltaY * unit));
      zoomAt(Math.exp(-step * (e.ctrlKey ? WHEEL_PINCH_ZOOM : WHEEL_ZOOM)), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [view]);

  const zoomAt = (factor: number, sx?: number, sy?: number) => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const c = cam.current;
    const px = sx ?? w / 2;
    const py = sy ?? h / 2;
    const before = fullMapFit(w, h) * c.zoom;
    const mx = c.cx + (px - w / 2) / before;
    const my = c.cy + (py - h / 2) / before;
    c.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom * factor));
    const after = fullMapFit(w, h) * c.zoom;
    c.cx = mx - (px - w / 2) / after;
    c.cy = my - (py - h / 2) / after;
    dirty.current = true;
  };

  const locate = () => {
    const me = view.getRadar().me;
    if (!me) return;
    const c = cam.current;
    c.zoom = Math.max(c.zoom, LOCATE_ZOOM);
    c.cx = me.x;
    c.cy = me.y;
    dirty.current = true;
  };

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0 });
    if (pointers.current.size >= 2) pinch.current = { distance: pinchState()?.distance ?? 0, multi: true };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const before = pinchState();
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved += Math.hypot(dx, dy);
    const { k } = transform.current;
    const after = pinchState();
    if (before && after) {
      const rect = e.currentTarget.getBoundingClientRect();
      cam.current.cx -= (after.x - before.x) / k;
      cam.current.cy -= (after.y - before.y) / k;
      if (before.distance > 0) zoomAt(after.distance / before.distance, after.x - rect.left, after.y - rect.top);
      dirty.current = true;
      return;
    }
    if (pinch.current.multi || p.moved < DRAG_THRESHOLD) return;
    cam.current.cx -= dx / k;
    cam.current.cy -= dy / k;
    dirty.current = true;
  };

  const release = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointers.current.get(e.pointerId);
    const wasMulti = pinch.current.multi;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) pinch.current.multi = false;
    return wasMulti ? undefined : p;
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? PLACES.filter((p) => [p.name, ...(p.aliases ?? [])].some((name) => name.toLowerCase().includes(q))) : PLACES.filter((p) => isMajorPlace(p.name, p.kind));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [query]);

  const shops = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? VENDORS.filter((v) => `${v.name} ${v.area}`.toLowerCase().includes(q)) : VENDORS;
  }, [query]);

  const toggleBuying = () => {
    setBuying((on) => !on);
    setMarket(null);
    dirty.current = true;
  };

  /** Offer the rides the school allows; a short hop is just walked. */
  const goTo = (p: Point, name = UNNAMED_PLACE) => {
    const options = view.travelOptions(p);
    if (options.length > 1) return setChoice({ target: p, name, options });
    view.navigateTo(p);
    onClose();
  };
  const goPlace = (p: Place) => goTo(p.door, p.name);
  const short = (n: string) => n.replace(/ Hall of Residence$/, " Hall");

  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = release(e);
    if (!p || p.moved >= DRAG_THRESHOLD) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { k, ox, oy } = transform.current;
    const x = (e.clientX - rect.left - ox) / k;
    const y = (e.clientY - rect.top - oy) / k;
    if (buying) {
      const near = PINNED_VENDORS.map((v) => ({ v, d: Math.hypot(v.point.x - x, v.point.y - y) * k })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < TAP_RADIUS_PX) return setMarket({ vendorId: near.v.id });
    }
    // Tapped a building with a name? Go to its entrance.
    const named = PLACES.find((p) => p.building !== undefined && pointInPoly(x, y, BUILDINGS[p.building].poly));
    if (named) return goPlace(named);
    // Tapped any building? Walk to the closest point outside it (the GPS handles that).
    const nearLabel = PLACES.map((p) => ({ p, d: Math.hypot(p.label.x - x, p.label.y - y) })).sort((a, b) => a.d - b.d)[0];
    if (nearLabel && nearLabel.d * k < TAP_RADIUS_PX) return goPlace(nearLabel.p);
    goTo({ x, y });
  };

  return (
    <GamePanel className="fullmap" label="Campus map" onClose={onClose}>
      <div className="fullmap-bar">
        <h2 className="fullmap-title"><GameIcon name="map" />Campus map</h2>
        <input
          className="fullmap-search"
          type="search"
          placeholder={buying ? "Search shops, e.g. New Buka, Spectra" : "Where to? e.g. Moremi, Library, SUB"}
          aria-label={buying ? "Search places to buy from" : "Search campus places"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="go"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (buying) {
              if (shops[0]) setMarket({ vendorId: shops[0].id });
            } else if (results[0]) goPlace(results[0]);
          }}
        />
        <button type="button" className={`btn btn-ghost fullmap-buy${buying ? " active" : ""}`} aria-pressed={buying} onClick={toggleBuying}>
          <GameIcon name="bag" />
          {COPY.buy}
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close map">
          <GameIcon name="close" />
        </button>
      </div>
      <div className="fullmap-view">
        <canvas ref={ref} className="fullmap-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onTap} onPointerCancel={release} />
        <div className="fullmap-zoom">
          <button className="icon-btn" onClick={() => zoomAt(ZOOM_STEP)} aria-label="Zoom in">
            +
          </button>
          <button className="icon-btn" onClick={() => zoomAt(1 / ZOOM_STEP)} aria-label="Zoom out">
            −
          </button>
          <button className="icon-btn" onClick={locate} aria-label="Show where I am">
            <GameIcon name="locate" />
          </button>
        </div>
      </div>
      {choice && (
        <TravelOptions
          destination={short(choice.name)}
          cash={view.cash}
          options={choice.options}
          onPick={(option) => {
            view.travelBy(choice.target, option);
            onClose();
          }}
          onBack={() => setChoice(null)}
        />
      )}
      {market && (
        <div
          className="fullmap-market"
          role="dialog"
          aria-label={COPY.buyLabel}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            setMarket(null);
          }}
        >
          <button type="button" className="btn btn-ghost fullmap-market-close" onClick={() => setMarket(null)}>
            <GameIcon name="back" />
            {COPY.buyClose}
          </button>
          <MarketFlow
            from={view.getRadar().me}
            vendorId={market.vendorId}
            onWalk={(vendor) => {
              if (!vendor.point) return;
              setMarket(null);
              goTo(vendor.point, vendor.name);
            }}
          />
        </div>
      )}
      {buying ? (
        <div className="fullmap-places">
          <button className="chip active" onClick={() => setMarket({})}>
            {COPY.buyList}
          </button>
          {shops.map((v) => (
            <button key={v.id} className="chip" onClick={() => setMarket({ vendorId: v.id })}>
              {v.name}
            </button>
          ))}
          {!shops.length && <span className="fullmap-hint">{COPY.noVendor} “{query}”</span>}
        </div>
      ) : (
        <div className="fullmap-places">
          {results.map((p) => (
            <button key={p.id} className="chip" onClick={() => goPlace(p)}>
              {p.name}
            </button>
          ))}
          {!results.length && <span className="fullmap-hint">{COPY.noPlace} “{query}”</span>}
        </div>
      )}
    </GamePanel>
  );
}
