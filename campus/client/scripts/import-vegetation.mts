import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromUrl } from "geotiff";
import { BBOX, mPerLat, mPerLon } from "./campus-frame.mts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canopyCache = path.join(webRoot, ".cache/vegetation/canopy.bin");
const coverCache = path.join(webRoot, ".cache/vegetation/cover.bin");
const outFile = path.join(webRoot, "game/scenery/vegetation.json");

const CANOPY_URL = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm";
const CANOPY_ZOOM = 10;
const COVER_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map";
const COVER_TILE_DEG = 3;
const COVER_PX_PER_DEG = 12000;
const COVER_GREEN = new Set([10, 20, 30]);
const ATTRIBUTION =
  "Tree and shrub positions from the Global Canopy Height Map by Meta and World Resources Institute (CC BY 4.0), filtered with ESA WorldCover 2021 v200 (CC BY 4.0)";
const EARTH_RADIUS = 6378137;
const MIN_TREE_M = 4;
const SHRUB = { cellM: 8, minM: 1, share: 0.7 };

const W = Math.round((BBOX.east - BBOX.west) * mPerLon);
const H = Math.round((BBOX.north - BBOX.south) * mPerLat);

const mercX = (lon: number) => ((lon * Math.PI) / 180) * EARTH_RADIUS;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * EARTH_RADIUS;

function quadkey(lat: number, lon: number, zoom: number): string {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  let key = "";
  for (let i = zoom; i > 0; i--) {
    const mask = 1 << (i - 1);
    key += (x & mask ? 1 : 0) + (y & mask ? 2 : 0);
  }
  return key;
}

async function downloadCanopy(): Promise<Uint8Array> {
  const grid = new Uint8Array(W * H);
  const keys = new Set([BBOX.south, BBOX.north].flatMap((lat) => [BBOX.west, BBOX.east].map((lon) => quadkey(lat, lon, CANOPY_ZOOM))));
  for (const key of keys) {
    const url = `${CANOPY_URL}/${key}.tif`;
    console.log("reading", url);
    const image = await (await fromUrl(url)).getImage();
    const [left, , , top] = image.getBoundingBox();
    const [res] = image.getResolution();
    const col = (lon: number) => Math.floor((mercX(lon) - left) / res);
    const row = (lat: number) => Math.floor((top - mercY(lat)) / res);
    const x0 = Math.max(0, col(BBOX.west));
    const x1 = Math.min(image.getWidth(), col(BBOX.east) + 1);
    const y0 = Math.max(0, row(BBOX.north));
    const y1 = Math.min(image.getHeight(), row(BBOX.south) + 1);
    if (x1 <= x0 || y1 <= y0) continue;
    const [band] = await image.readRasters({ window: [x0, y0, x1, y1] });
    if (typeof band === "number") throw new Error(`canopy tile ${key} has no raster band`);
    const span = x1 - x0;
    for (let y = 0; y < H; y++) {
      const sy = row(BBOX.north - (y + 0.5) / mPerLat);
      if (sy < y0 || sy >= y1) continue;
      for (let x = 0; x < W; x++) {
        const sx = col(BBOX.west + (x + 0.5) / mPerLon);
        if (sx >= x0 && sx < x1) grid[y * W + x] = band[(sy - y0) * span + sx - x0];
      }
    }
  }
  return grid;
}

async function downloadCover(): Promise<Uint8Array> {
  const grid = new Uint8Array(W * H);
  const south = Math.floor(BBOX.south / COVER_TILE_DEG) * COVER_TILE_DEG;
  const west = Math.floor(BBOX.west / COVER_TILE_DEG) * COVER_TILE_DEG;
  if (BBOX.north >= south + COVER_TILE_DEG || BBOX.east >= west + COVER_TILE_DEG) throw new Error("campus crosses a WorldCover tile edge");
  const name = `${south < 0 ? "S" : "N"}${String(Math.abs(south)).padStart(2, "0")}${west < 0 ? "W" : "E"}${String(Math.abs(west)).padStart(3, "0")}`;
  const url = `${COVER_URL}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
  console.log("reading", url);
  const image = await (await fromUrl(url)).getImage();
  const top = south + COVER_TILE_DEG;
  const col = (lon: number) => Math.floor((lon - west) * COVER_PX_PER_DEG);
  const row = (lat: number) => Math.floor((top - lat) * COVER_PX_PER_DEG);
  const x0 = col(BBOX.west);
  const x1 = col(BBOX.east) + 1;
  const y0 = row(BBOX.north);
  const y1 = row(BBOX.south) + 1;
  const [band] = await image.readRasters({ window: [x0, y0, x1, y1] });
  if (typeof band === "number") throw new Error("WorldCover tile has no raster band");
  const span = x1 - x0;
  for (let y = 0; y < H; y++) {
    const sy = row(BBOX.north - (y + 0.5) / mPerLat) - y0;
    for (let x = 0; x < W; x++) grid[y * W + x] = band[sy * span + col(BBOX.west + (x + 0.5) / mPerLon) - x0];
  }
  return grid;
}

async function load(file: string, fresh: boolean, download: () => Promise<Uint8Array>): Promise<Uint8Array> {
  if (!fresh) {
    try {
      const cached = await readFile(file);
      if (cached.length === W * H) return new Uint8Array(cached);
    } catch {
      console.log("no cache at", path.relative(webRoot, file));
    }
  }
  const grid = await download();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, grid);
  return grid;
}

function blur(src: Float32Array): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[(y + dy) * W + x + dx];
      out[y * W + x] = sum / 9;
    }
  return out;
}

interface Top {
  x: number;
  y: number;
  h: number;
}

function findTops(canopy: Uint8Array): Top[] {
  const smooth = blur(blur(Float32Array.from(canopy)));
  const tops: Top[] = [];
  for (let y = 6; y < H - 6; y++)
    for (let x = 6; x < W - 6; x++) {
      const h = smooth[y * W + x];
      if (h < MIN_TREE_M) continue;
      const reach = h < 8 ? 2 : h < 15 ? 3 : 5;
      let peak = true;
      for (let dy = -reach; dy <= reach && peak; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          if (!dx && !dy) continue;
          const other = smooth[(y + dy) * W + x + dx];
          if (other > h || (other === h && (dy < 0 || (dy === 0 && dx < 0)))) {
            peak = false;
            break;
          }
        }
      if (peak) tops.push({ x, y, h });
    }
  return tops;
}

function findShrubs(canopy: Uint8Array, cover: Uint8Array): Top[] {
  const shrubs: Top[] = [];
  const cell = SHRUB.cellM;
  for (let cy = 0; cy + cell <= H; cy += cell)
    for (let cx = 0; cx + cell <= W; cx += cell) {
      if (!COVER_GREEN.has(cover[(cy + (cell >> 1)) * W + cx + (cell >> 1)])) continue;
      let low = 0;
      let sumX = 0;
      let sumY = 0;
      let sumH = 0;
      let tall = false;
      for (let y = cy; y < cy + cell && !tall; y++)
        for (let x = cx; x < cx + cell; x++) {
          const h = canopy[y * W + x];
          if (h >= MIN_TREE_M) {
            tall = true;
            break;
          }
          if (h < SHRUB.minM) continue;
          low++;
          sumX += x;
          sumY += y;
          sumH += h;
        }
      if (tall || low < cell * cell * SHRUB.share) continue;
      shrubs.push({ x: Math.round(sumX / low), y: Math.round(sumY / low), h: Math.round(sumH / low) });
    }
  return shrubs;
}

const fresh = process.argv.includes("--fresh");
const canopy = await load(canopyCache, fresh, downloadCanopy);
const cover = await load(coverCache, fresh, downloadCover);
const trees = findTops(canopy);
const shrubs = findShrubs(canopy, cover);
let covered = 0;
let low = 0;
for (const h of canopy) {
  if (h >= MIN_TREE_M) covered++;
  else if (h >= 1) low++;
}
await writeFile(
  outFile,
  JSON.stringify({
    attribution: ATTRIBUTION,
    generated: new Date().toISOString().slice(0, 10),
    width: W,
    height: H,
    trees: trees.flatMap((t) => [t.x, t.y, Math.round(t.h)]),
    shrubs: shrubs.flatMap((t) => [t.x, t.y, t.h]),
  }) + "\n",
);
console.log(
  `campus ${W}m x ${H}m\n` +
    `canopy ${MIN_TREE_M}m and taller ${((covered / canopy.length) * 100).toFixed(1)}%  low growth 1 to ${MIN_TREE_M - 1}m ${((low / canopy.length) * 100).toFixed(1)}%\n` +
    `tree tops ${trees.length}  shrub clumps ${shrubs.length}\n` +
    `wrote ${path.relative(process.cwd(), outFile)}`,
);
