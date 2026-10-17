/**
 * 2D map rendering for the GTA-style minimap and the full-screen map.
 * The campus is drawn once into an offscreen canvas from the shared map
 * data; each frame just copies part of it and draws a few dots on top.
 */
import {
  AREAS,
  BUILDINGS,
  BUILDING_STYLE,
  GROUND_COLORS,
  LINES,
  MAP_ATTRIBUTION,
  MAP_HEIGHT_PX,
  MAP_WIDTH_PX,
  PLACES,
  ROADS,
  STALLS,
  type Point,
} from "@campuslife/shared";
import type { Radar } from "./CampusView";
import { uiFontFamily } from "./fonts";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Full campus at `scale` canvas pixels per map pixel. */
export function renderMapBase(scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(MAP_WIDTH_PX * scale);
  c.height = Math.ceil(MAP_HEIGHT_PX * scale);
  const g = c.getContext("2d")!;
  g.scale(scale, scale);
  g.fillStyle = hex(GROUND_COLORS.grass);
  g.fillRect(0, 0, MAP_WIDTH_PX, MAP_HEIGHT_PX);
  const polyPath = (poly: readonly number[]) => {
    g.beginPath();
    for (let i = 0; i < poly.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, poly[i], poly[i + 1]);
    g.closePath();
  };
  for (const a of AREAS) {
    if (a.kind === "grass") continue;
    g.fillStyle = hex(GROUND_COLORS[a.kind]);
    polyPath(a.poly);
    g.fill();
  }
  g.lineCap = g.lineJoin = "round";
  for (const pass of ["path", "road"] as const) {
    for (const r of ROADS) {
      if (r.kind !== pass) continue;
      g.strokeStyle = pass === "road" ? "#e9e6df" : hex(GROUND_COLORS.path);
      g.lineWidth = Math.max(r.width * (pass === "road" ? 1.4 : 1), 1 / scale);
      g.beginPath();
      for (let i = 0; i < r.pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, r.pts[i], r.pts[i + 1]);
      g.stroke();
    }
  }
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.lineWidth = 1.2 / scale;
  for (const b of BUILDINGS) {
    g.fillStyle = hex(BUILDING_STYLE[b.kind].roofs[(b.id * 2654435761) % BUILDING_STYLE[b.kind].roofs.length >>> 0]);
    polyPath(b.poly);
    g.fill();
    g.stroke();
  }
  // Food stalls: orange dots.
  g.fillStyle = "#f97316";
  g.strokeStyle = "#ffffff";
  g.lineWidth = 1 / scale;
  for (const st of STALLS) {
    g.beginPath();
    g.arc(st.x, st.y, 3 / scale, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  return c;
}

/** The most useful places to label on the full map (others stay findable via search). */
export function isMajorPlace(name: string, kind: string) {
  return kind === "hostel" || kind === "area" || kind === "food" || /student union|library|oduduwa|senate building|amphi|faculty of (arts \(block 1|technology|law|social|education|administration|pharmacy)|sports|bowl|1000 seater|market/i.test(name);
}

/** Draws the player arrow (yaw = three.js rotation; map heading = (sin, cos)). */
function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, yaw: number, size: number) {
  const hx = Math.sin(yaw);
  const hy = Math.cos(yaw);
  g.save();
  g.translate(x, y);
  g.rotate(Math.atan2(hy, hx) + Math.PI / 2);
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.75, size * 0.8);
  g.lineTo(0, size * 0.4);
  g.lineTo(-size * 0.75, size * 0.8);
  g.closePath();
  g.fillStyle = "#facc15";
  g.strokeStyle = "#1c1917";
  g.lineWidth = 2;
  g.fill();
  g.stroke();
  g.restore();
}

function drawRoute(g: CanvasRenderingContext2D, from: Point | undefined, route: Point[], toScreen: (p: Point) => Point, width: number) {
  if (!route.length || !from) return;
  g.save();
  g.strokeStyle = "#facc15";
  g.lineWidth = width;
  g.setLineDash([width * 1.6, width]);
  g.beginPath();
  const s = toScreen(from);
  g.moveTo(s.x, s.y);
  for (const p of route) {
    const q = toScreen(p);
    g.lineTo(q.x, q.y);
  }
  g.stroke();
  const end = toScreen(route[route.length - 1]);
  g.setLineDash([]);
  g.fillStyle = "#facc15";
  g.beginPath();
  g.arc(end.x, end.y, width * 1.8, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

const VEHICLE_COLORS = { shuttle: "#16a34a", bus: "#2563eb", student: "#f97316" } as const;

function drawVehicles(g: CanvasRenderingContext2D, radar: Radar, toScreen: (p: Point) => Point, r: number, clip?: number) {
  for (const v of radar.vehicles) {
    const s = toScreen(v);
    if (clip !== undefined && (Math.abs(s.x) > clip || Math.abs(s.y) > clip)) continue;
    g.fillStyle = VEHICLE_COLORS[v.kind];
    g.strokeStyle = "#ffffff";
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(s.x - r, s.y - r * 0.75, r * 2, r * 1.5, r * 0.4);
    g.fill();
    g.stroke();
  }
}

/** Shuttle/bus lines and their stops (full map only). */
function drawLines(g: CanvasRenderingContext2D, toScreen: (p: Point) => Point) {
  g.save();
  g.lineWidth = 2;
  g.globalAlpha = 0.55;
  for (const line of LINES) {
    g.strokeStyle = VEHICLE_COLORS[line.kind];
    g.beginPath();
    for (let i = 0; i < line.pts.length; i += 2) {
      const q = toScreen({ x: line.pts[i], y: line.pts[i + 1] });
      if (i) g.lineTo(q.x, q.y);
      else g.moveTo(q.x, q.y);
    }
    g.closePath();
    g.stroke();
  }
  g.globalAlpha = 1;
  for (const line of LINES)
    for (const st of line.stops) {
      const q = toScreen(st);
      g.fillStyle = "#ffffff";
      g.strokeStyle = VEHICLE_COLORS[line.kind];
      g.lineWidth = 2;
      g.beginPath();
      g.arc(q.x, q.y, 3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  g.restore();
}

/**
 * Minimap: a window of `viewPx` map pixels centred on the player, drawn into
 * a `size` x `size` canvas and rotated so "up" is where the camera looks
 * (GTA-style). The N marker orbits the rim to show north.
 */
export function drawMinimap(g: CanvasRenderingContext2D, base: HTMLCanvasElement, baseScale: number, radar: Radar, size: number, viewPx: number) {
  const me = radar.me;
  const cx = me?.x ?? MAP_WIDTH_PX / 2;
  const cy = me?.y ?? MAP_HEIGHT_PX / 2;
  const k = size / viewPx; // screen px per map px
  const half = size / 2;
  // Draw a slightly larger area so rotated corners aren't empty.
  const span = viewPx * Math.SQRT2;
  g.clearRect(0, 0, size, size);
  g.fillStyle = "#4a7a3e";
  g.fillRect(0, 0, size, size);

  g.save();
  g.translate(half, half);
  g.rotate(-radar.cameraYaw);
  g.drawImage(base, (cx - span / 2) * baseScale, (cy - span / 2) * baseScale, span * baseScale, span * baseScale, -span * k / 2, -span * k / 2, span * k, span * k);
  const toScreen = (p: Point) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k });
  drawRoute(g, me, radar.route, toScreen, 3);
  g.fillStyle = "#3b82f6";
  g.strokeStyle = "#ffffff";
  g.lineWidth = 1.5;
  for (const o of radar.others) {
    const s = toScreen(o);
    if (Math.abs(s.x) > half + 4 || Math.abs(s.y) > half + 4) continue;
    g.beginPath();
    g.arc(s.x, s.y, 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  drawVehicles(g, radar, toScreen, 5, half + 6);
  if (me) drawArrow(g, 0, 0, me.yaw, 8);
  g.restore();

  // North marker on the rim.
  const r = half - 10;
  const nx = half - r * Math.sin(radar.cameraYaw);
  const ny = half - r * Math.cos(radar.cameraYaw);
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.beginPath();
  g.arc(nx, ny, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = `800 10px ${uiFontFamily()}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("N", nx, ny + 0.5);
}

export interface MapCamera {
  zoom: number;
  cx: number;
  cy: number;
}

export const FULL_MAP_ALL_LABELS_ZOOM = 3;

/** A marker laid over the full map, such as a place to buy things. */
export interface MapPin {
  point: Point;
  color: string;
  label: string;
}

const PIN_RADIUS = 6;
const PIN_LABEL_GAP = 13;

function drawPins(g: CanvasRenderingContext2D, pins: readonly MapPin[], toScreen: (p: Point) => Point, labels: boolean) {
  for (const pin of pins) {
    const s = toScreen(pin.point);
    g.beginPath();
    g.arc(s.x, s.y, PIN_RADIUS, 0, Math.PI * 2);
    g.fillStyle = pin.color;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "#ffffff";
    g.stroke();
    if (!labels) continue;
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.8)";
    g.strokeText(pin.label, s.x, s.y + PIN_LABEL_GAP);
    g.fillStyle = "#ffe9b0";
    g.fillText(pin.label, s.x, s.y + PIN_LABEL_GAP);
  }
}

export function fullMapFit(w: number, h: number) {
  return Math.min(w / MAP_WIDTH_PX, h / MAP_HEIGHT_PX);
}

/** Full map drawn into w x h with labels. Returns the transform for hit-testing taps. */
export function drawFullMap(g: CanvasRenderingContext2D, base: HTMLCanvasElement, radar: Radar, w: number, h: number, cam: MapCamera, pins: readonly MapPin[] = []) {
  const k = fullMapFit(w, h) * cam.zoom;
  const ox = w / 2 - cam.cx * k;
  const oy = h / 2 - cam.cy * k;
  g.clearRect(0, 0, w, h);
  g.drawImage(base, ox, oy, MAP_WIDTH_PX * k, MAP_HEIGHT_PX * k);
  const toScreen = (p: Point) => ({ x: ox + p.x * k, y: oy + p.y * k });

  g.font = `700 ${w < 500 ? 10 : 12}px ${uiFontFamily()}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const allLabels = cam.zoom >= FULL_MAP_ALL_LABELS_ZOOM;
  for (const p of PLACES) {
    if (!allLabels && !isMajorPlace(p.name, p.kind)) continue;
    const c = toScreen(p.label);
    if (c.x < -80 || c.x > w + 80 || c.y < -20 || c.y > h + 20) continue;
    const label = p.name.replace(/ Hall of Residence$/, " Hall").replace(/^Faculty of /, "").replace(/ \(Block 1\)$/, "");
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.8)";
    g.strokeText(label, c.x, c.y);
    g.fillStyle = "#ffffff";
    g.fillText(label, c.x, c.y);
  }
  drawLines(g, toScreen);
  drawRoute(g, radar.me, radar.route, toScreen, 3);
  drawVehicles(g, radar, toScreen, 5);
  drawPins(g, pins, toScreen, allLabels);
  g.fillStyle = "#3b82f6";
  g.strokeStyle = "#ffffff";
  g.lineWidth = 1.5;
  for (const o of radar.others) {
    const s = toScreen(o);
    g.beginPath();
    g.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  if (radar.me) {
    const s = toScreen(radar.me);
    drawArrow(g, s.x, s.y, radar.me.yaw, 9);
  }
  // OSM attribution (required by the ODbL).
  g.font = `500 10px ${uiFontFamily()}`;
  g.textAlign = "right";
  g.textBaseline = "bottom";
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillText(MAP_ATTRIBUTION, w - 6, h - 4);
  return { k, ox, oy };
}
