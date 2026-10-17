import * as THREE from "three";
import { BANNER_SIZES, BANNER_SPOTS, assignBanners, bannerFeed, bannerFeedSignature, gameMinutesAt, gameTime, type GameTime } from "@campuslife/shared";
import { ATLAS_SIZE, ATLAS_SIZE_LOW, cellUv, packAtlas } from "./banner-layout";
import { BANNER_CHUNK_M, VERTS_PER_COLUMN, planChunks, type BannerChunk } from "./banner-mesh";
import { createAtlasCanvas, paintAtlas, type AtlasFace } from "./banner-paint";
import { mergeParts } from "./kit";

export interface Banners {
  group: THREE.Group;
  count: number;
  faces(): number;
  update(focus: THREE.Vector3, viewFar: number): void;
  setNight(night: number): void;
  setTime(t: GameTime): void;
  dispose(): void;
}

const LOOK = {
  blank: 0x8b8f94,
  minRange: 220,
  maxRange: 420,
  updateEvery: 12,
  phaseHours: 6,
  nightGlow: 0.42,
  anisotropy: 4,
  waveSpeed: 2.3,
  waveScale: 0.9,
  waveDepth: 0.045,
  timeWrap: 600,
};
const CHUNK_REACH = BANNER_CHUNK_M * Math.SQRT1_2;

function addWave(mat: THREE.Material, time: { value: number }) {
  const inner = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    inner.call(mat, shader, renderer);
    shader.uniforms.uBannerTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway;\nuniform float uBannerTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\ntransformed += normal * aSway * sin(uBannerTime * ${LOOK.waveSpeed.toFixed(2)} + (position.x + position.z) * ${LOOK.waveScale.toFixed(2)}) * ${LOOK.waveDepth.toFixed(3)};`,
      );
  };
  mat.customProgramCacheKey = () => "oau-banner-cloth";
}

export function buildBanners(opts: { shadows: boolean; patch: (mat: THREE.Material) => void }): Banners {
  const group = new THREE.Group();
  const spots = BANNER_SPOTS;
  const size = opts.shadows ? ATLAS_SIZE : ATLAS_SIZE_LOW;
  const canvas = createAtlasCanvas(size);
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = LOOK.anisotropy;
  }
  const time = { value: 0 };
  const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  opts.patch(frameMat);
  const faceMat = new THREE.MeshLambertMaterial(texture ? { map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0 } : { color: LOOK.blank });
  opts.patch(faceMat);
  addWave(faceMat, time);

  const built: { chunk: BannerChunk; frame: THREE.Mesh; cloth: THREE.Mesh; uv: THREE.BufferAttribute }[] = [];
  for (const chunk of planChunks(spots)) {
    const frame = new THREE.Mesh(mergeParts(chunk.parts), frameMat);
    frame.castShadow = opts.shadows;
    const geo = new THREE.BufferGeometry();
    const uv = new THREE.BufferAttribute(new Float32Array((chunk.positions.length / 3) * 2), 2);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(chunk.positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(chunk.normals, 3));
    geo.setAttribute("aSway", new THREE.Float32BufferAttribute(chunk.sway, 1));
    geo.setAttribute("uv", uv);
    const cloth = new THREE.Mesh(geo, faceMat);
    frame.visible = cloth.visible = false;
    group.add(frame, cloth);
    built.push({ chunk, frame, cloth, uv });
  }

  let faceCount = 0;
  const refresh = (t: GameTime, feed = bannerFeed(t)) => {
    const picked = assignBanners(spots, feed, t);
    const index = new Map<string, number>();
    const faces: AtlasFace[] = [];
    const faceOf = (spot: number, slot: number): number => {
      const shape = BANNER_SIZES[spots[spot].kind].shape;
      const art = picked[spot][slot] ?? picked[spot][0];
      if (!shape || !art) return -1;
      const key = `${shape}:${art.id}`;
      let i = index.get(key);
      if (i === undefined) {
        i = faces.length;
        index.set(key, i);
        faces.push({ art, shape });
      }
      return i;
    };
    const wanted = built.map((b) => b.chunk.quads.map((q) => faceOf(q.spot, q.slot)));
    const cells = packAtlas(faces.map((f) => f.shape), size);
    built.forEach((b, bi) => {
      b.chunk.quads.forEach((q, qi) => {
        const cell = cells[wanted[bi][qi]];
        const [u0, v0, u1, v1] = cell ? cellUv(cell, size) : [0, 0, 0, 0];
        for (let k = 0; k < q.cols; k++) {
          const ua = u0 + ((u1 - u0) * k) / q.cols;
          const ub = u0 + ((u1 - u0) * (k + 1)) / q.cols;
          const o = q.start + k * VERTS_PER_COLUMN;
          b.uv.setXY(o, ua, v0);
          b.uv.setXY(o + 1, ub, v0);
          b.uv.setXY(o + 2, ub, v1);
          b.uv.setXY(o + 3, ua, v0);
          b.uv.setXY(o + 4, ub, v1);
          b.uv.setXY(o + 5, ua, v1);
        }
      });
      b.uv.needsUpdate = true;
    });
    if (canvas && texture && paintAtlas(canvas, faces, cells)) texture.needsUpdate = true;
    faceCount = faces.length;
  };

  let phase = Number.NaN;
  let signature = "";
  const setTime = (t: GameTime) => {
    const now = Math.floor(t.total);
    if (now === phase) return;
    phase = now;
    const feed = bannerFeed(t);
    const sig = `${t.dayIndex}|${bannerFeedSignature(feed)}`;
    if (sig === signature) return;
    signature = sig;
    refresh(t, feed);
  };
  setTime(gameTime(gameMinutesAt(Date.now())));

  let frame = 0;
  return {
    group,
    count: spots.length,
    faces: () => faceCount,
    update(focus, viewFar) {
      time.value = (performance.now() / 1000) % LOOK.timeWrap;
      if (frame++ % LOOK.updateEvery !== 0) return;
      const reach = Math.min(LOOK.maxRange, Math.max(LOOK.minRange, viewFar));
      for (const b of built) b.frame.visible = b.cloth.visible = Math.hypot(b.chunk.cx - focus.x, b.chunk.cz - focus.z) - CHUNK_REACH < reach;
    },
    setNight(night) {
      faceMat.emissiveIntensity = Math.min(1, Math.max(0, night)) * LOOK.nightGlow;
    },
    setTime,
    dispose() {
      for (const b of built) {
        b.frame.geometry.dispose();
        b.cloth.geometry.dispose();
      }
      frameMat.dispose();
      faceMat.dispose();
      texture?.dispose();
    },
  };
}
