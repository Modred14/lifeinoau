import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromUrl } from "geotiff";
import { BBOX, PX_PER_M, mPerLat, mPerLon } from "./campus-frame.mts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const campusFile = path.resolve(webRoot, "../shared/src/data/campus.json");
const outFile = path.resolve(webRoot, "../shared/src/data/building-heights.json");

const BUCKET = "open-buildings-temporal-data";
const TILE_PREFIX = "v1/geotiffs/10384_2023_06_30/";
const ATTRIBUTION = "Building heights from Google Open Buildings 2.5D Temporal, 2023 (CC BY 4.0)";
const UTM_ZONE = 31;
const TILE_M_PER_PX = 0.5;
const HEIGHT_BAND = 1;
const PRESENCE_BAND = 2;
const SAMPLE_M = 2;
const GUESSED = { kind: "other", heights: [4.5, 8] };
const TRUST = { presence: 0.5, cover: 0.6, cells: 12, changeM: 3, minM: 3, maxM: 15 };

function utm(lat: number, lon: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const p = (lat * Math.PI) / 180;
  const l = (lon * Math.PI) / 180;
  const l0 = (((UTM_ZONE - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const t = Math.tan(p) ** 2;
  const c = ep2 * Math.cos(p) ** 2;
  const A = Math.cos(p) * (l - l0);
  const m =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const east = k0 * n * (A + ((1 - t + c) * A ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * A ** 5) / 120) + 500000;
  const north = k0 * (m + n * Math.tan(p) * ((A * A) / 2 + ((5 - t + 9 * c + 4 * c * c) * A ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * A ** 6) / 720));
  return [east, north];
}

async function listTiles(): Promise<string[]> {
  const names: string[] = [];
  let token = "";
  do {
    const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(TILE_PREFIX)}&fields=items(name),nextPageToken${token ? `&pageToken=${token}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tile listing failed: ${res.status}`);
    const page = (await res.json()) as { items?: { name: string }[]; nextPageToken?: string };
    for (const item of page.items ?? []) if (item.name.endsWith(".tif")) names.push(item.name);
    token = page.nextPageToken ?? "";
  } while (token);
  return names;
}

const W = Math.round((BBOX.east - BBOX.west) * mPerLon);
const H = Math.round((BBOX.north - BBOX.south) * mPerLat);
const gw = Math.ceil(W / SAMPLE_M);
const gh = Math.ceil(H / SAMPLE_M);

async function surveyGrid(): Promise<{ height: Float32Array; presence: Float32Array }> {
  const height = new Float32Array(gw * gh);
  const presence = new Float32Array(gw * gh);
  const corners = [BBOX.south, BBOX.north].flatMap((lat) => [BBOX.west, BBOX.east].map((lon) => utm(lat, lon)));
  const e0 = Math.min(...corners.map((c) => c[0]));
  const e1 = Math.max(...corners.map((c) => c[0]));
  const n0 = Math.min(...corners.map((c) => c[1]));
  const n1 = Math.max(...corners.map((c) => c[1]));
  for (const name of await listTiles()) {
    const image = await (await fromUrl(`https://storage.googleapis.com/${BUCKET}/${name}`)).getImage();
    const [left, bottom, right, top] = image.getBoundingBox();
    if (right < e0 || left > e1 || top < n0 || bottom > n1) continue;
    console.log("reading", name);
    const x0 = Math.max(0, Math.floor((e0 - left) / TILE_M_PER_PX));
    const x1 = Math.min(image.getWidth(), Math.ceil((e1 - left) / TILE_M_PER_PX));
    const y0 = Math.max(0, Math.floor((top - n1) / TILE_M_PER_PX));
    const y1 = Math.min(image.getHeight(), Math.ceil((top - n0) / TILE_M_PER_PX));
    const bands = await image.readRasters({ window: [x0, y0, x1, y1], samples: [HEIGHT_BAND, PRESENCE_BAND] });
    const heights = bands[0];
    const seen = bands[1];
    if (typeof heights === "number" || typeof seen === "number") throw new Error(`${name} has no raster bands`);
    const span = x1 - x0;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const [east, north] = utm(BBOX.north - ((y + 0.5) * SAMPLE_M) / mPerLat, BBOX.west + ((x + 0.5) * SAMPLE_M) / mPerLon);
        const sx = Math.floor((east - left) / TILE_M_PER_PX);
        const sy = Math.floor((top - north) / TILE_M_PER_PX);
        if (sx < x0 || sx >= x1 || sy < y0 || sy >= y1) continue;
        height[y * gw + x] = heights[(sy - y0) * span + sx - x0];
        presence[y * gw + x] = seen[(sy - y0) * span + sx - x0];
      }
  }
  return { height, presence };
}

function inPoly(x: number, y: number, pts: number[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2)
    if (pts[i + 1] > y !== pts[j + 1] > y && x < ((pts[j] - pts[i]) * (y - pts[i + 1])) / (pts[j + 1] - pts[i + 1]) + pts[i]) inside = !inside;
  return inside;
}

interface Imported {
  name?: string;
  kind: string;
  h: number;
  pts: number[];
}

const campus = JSON.parse(await readFile(campusFile, "utf8")) as { buildings: Imported[] };
const { height, presence } = await surveyGrid();
const cellPx = SAMPLE_M * PX_PER_M;
const heights: Record<string, number> = {};
let measured = 0;
campus.buildings.forEach((b, id) => {
  if (b.name || b.kind !== GUESSED.kind || !GUESSED.heights.includes(b.h)) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < b.pts.length; i += 2) {
    x0 = Math.min(x0, b.pts[i]);
    x1 = Math.max(x1, b.pts[i]);
    y0 = Math.min(y0, b.pts[i + 1]);
    y1 = Math.max(y1, b.pts[i + 1]);
  }
  const found: number[] = [];
  let cells = 0;
  for (let y = Math.max(0, Math.floor(y0 / cellPx)); y <= Math.min(gh - 1, Math.floor(y1 / cellPx)); y++)
    for (let x = Math.max(0, Math.floor(x0 / cellPx)); x <= Math.min(gw - 1, Math.floor(x1 / cellPx)); x++) {
      if (!inPoly((x + 0.5) * cellPx, (y + 0.5) * cellPx, b.pts)) continue;
      cells++;
      if (presence[y * gw + x] > TRUST.presence) found.push(height[y * gw + x]);
    }
  if (cells < TRUST.cells || found.length < cells * TRUST.cover) return;
  measured++;
  found.sort((a, z) => a - z);
  const median = Math.min(TRUST.maxM, Math.max(TRUST.minM, Math.round(found[found.length >> 1] * 2) / 2));
  if (Math.abs(median - b.h) >= TRUST.changeM) heights[id] = median;
});
await writeFile(outFile, JSON.stringify({ attribution: ATTRIBUTION, generated: new Date().toISOString().slice(0, 10), heights }) + "\n");
console.log(`unnamed buildings with a guessed height that the survey covers well: ${measured}\nheights changed: ${Object.keys(heights).length}\nwrote ${path.relative(process.cwd(), outFile)}`);
