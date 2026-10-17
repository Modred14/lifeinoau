import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BANNER_FACE_BUDGET, BANNER_FACE_SHAPES, BANNER_SIZES, BANNER_SPOTS, MINUTES_PER_DAY, PX_PER_METER, bannerFeed, gameTime, type BannerFace } from "@campuslife/shared";
import { ATLAS_SIZE, ATLAS_SIZE_LOW, FACE_PX, cellUv, fitBlock, layoutFace, packAtlas, wrapText, type Measure } from "./banner-layout";
import { BANNER_CHUNK_M, VERTS_PER_COLUMN, planChunks } from "./banner-mesh";
import { buildBanners } from "./banners";

const M = PX_PER_METER;
const measure: Measure = (text, px, bold) => text.length * px * (bold ? 0.6 : 0.54);
const worst: BannerFace[] = BANNER_FACE_SHAPES.flatMap((shape) => Array.from({ length: BANNER_FACE_BUDGET[shape] }, () => shape));

test("the atlas holds a full day of faces with no overlap", () => {
  for (const size of [ATLAS_SIZE, ATLAS_SIZE_LOW]) {
    const cells = packAtlas(worst, size);
    assert.equal(cells.length, worst.length);
    cells.forEach((c, i) => {
      assert.equal(c.w, Math.floor((FACE_PX[worst[i]].w * size) / ATLAS_SIZE));
      assert.equal(c.h, Math.floor((FACE_PX[worst[i]].h * size) / ATLAS_SIZE));
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= size && c.y + c.h <= size, `cell ${i} leaves the atlas`);
    });
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i];
        const b = cells[j];
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `cells ${i} and ${j} overlap`);
      }
  }
});

test("UVs sit inside their cell with the top of the canvas at v = 1", () => {
  const [u0, v0, u1, v1] = cellUv({ x: 0, y: 0, w: 512, h: 256 }, 2048);
  assert.ok(u0 > 0 && u1 < 0.25 && u0 < u1);
  assert.ok(v1 < 1 && v1 > 0.99 && v0 > 0.875 && v0 < v1);
});

test("text wraps on words and long titles shrink to fit", () => {
  assert.deepEqual(wrapText("Say no to cultism", 60, 10, true, measure), ["Say no to", "cultism"]);
  const short = fitBlock(["PayKolo"], { w: 280, h: 60 }, { maxPx: 46, minPx: 17, maxLines: 2, wrap: true, bold: true }, measure);
  const long = fitBlock(["House of Mercy Students Assembly"], { w: 280, h: 60 }, { maxPx: 46, minPx: 17, maxLines: 2, wrap: true, bold: true }, measure);
  assert.equal(short.px, 46);
  assert.ok(long.px < short.px && long.px >= 17);
  assert.ok(long.lines.length <= 2 && long.lines.every((l) => measure(l, long.px, true) <= 280));
  const tight = fitBlock(["An extremely long line that can never fit in such a small box at all"], { w: 80, h: 12 }, { maxPx: 12, minPx: 8, maxLines: 1, wrap: false, bold: false }, measure);
  assert.equal(tight.lines.length, 1);
  assert.ok(measure(tight.lines[0], tight.px, false) <= 80);
});

test("every piece of art fits every face shape it can be printed on", () => {
  const arts = new Map<string, ReturnType<typeof bannerFeed>[number]>();
  for (let d = 0; d < 7; d++) for (const a of bannerFeed(gameTime((90 + d) * MINUTES_PER_DAY + 600))) arts.set(a.id, a);
  for (const art of arts.values())
    for (const shape of BANNER_FACE_SHAPES) {
      const cell = FACE_PX[shape];
      const d = layoutFace(art, shape, cell, measure);
      assert.ok(d.rects.length >= 2 && d.texts.length >= 1);
      assert.ok(d.texts.some((t) => t.bold && t.text.length > 0));
      for (const t of d.texts) {
        assert.ok(measure(t.text, t.px, t.bold) <= cell.w, `${art.id} overflows a ${shape}: ${t.text}`);
        assert.ok(t.y - t.px / 2 >= -1 && t.y + t.px / 2 <= cell.h + 1, `${art.id} text leaves a ${shape}`);
        assert.ok(t.px >= 6);
      }
    }
});

test("each spot gets its faces and frame in the chunk that owns it", () => {
  const chunks = planChunks(BANNER_SPOTS);
  const quads = chunks.flatMap((c) => c.quads);
  BANNER_SPOTS.forEach((s, i) => {
    const mine = quads.filter((q) => q.spot === i);
    const size = BANNER_SIZES[s.kind];
    assert.equal(mine.length, s.kind === "board" ? size.slots : size.shape ? 2 : 0, `${s.kind} ${i}`);
    const chunk = chunks.find((c) => Math.abs(c.cx - s.x / M) <= BANNER_CHUNK_M / 2 && Math.abs(c.cz - s.y / M) <= BANNER_CHUNK_M / 2);
    assert.ok(chunk && chunk.parts.length > 0);
  });
  for (const c of chunks) {
    assert.equal(c.positions.length, c.normals.length);
    assert.equal(c.sway.length, c.positions.length / 3);
    assert.equal(c.quads.reduce((n, q) => n + q.cols * VERTS_PER_COLUMN, 0), c.positions.length / 3);
    assert.ok(!c.positions.some((v) => Number.isNaN(v)) && !c.normals.some((v) => Number.isNaN(v)));
    for (const p of c.parts) p.geo.dispose();
  }
});

test("banners build without a canvas, cull by distance and refresh only when the feed can change", () => {
  let patched = 0;
  const banners = buildBanners({ shadows: true, patch: () => void patched++ });
  assert.equal(patched, 2);
  assert.equal(banners.count, BANNER_SPOTS.length);
  assert.ok(banners.faces() > 20 && banners.faces() <= worst.length, `${banners.faces()} faces`);
  const meshes = banners.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  assert.ok(meshes.length > 0 && meshes.length < 140 && meshes.every((m) => !m.visible));
  const spot = BANNER_SPOTS[0];
  banners.update(new THREE.Vector3(spot.x / M, 0, spot.y / M), 250);
  const shown = meshes.filter((m) => m.visible).length;
  assert.ok(shown > 0 && shown < meshes.length, `${shown} of ${meshes.length} shown`);
  const cloth = meshes.find((m) => m.geometry.getAttribute("uv"));
  assert.ok(cloth);
  const uvVersion = () => (cloth.geometry.getAttribute("uv") as THREE.BufferAttribute).version;
  const before = uvVersion();
  const t = gameTime(200 * MINUTES_PER_DAY + 600);
  banners.setTime(t);
  const after = uvVersion();
  assert.ok(after > before);
  banners.setTime(gameTime(200 * MINUTES_PER_DAY + 700));
  assert.equal(uvVersion(), after);
  banners.setNight(1);
  banners.dispose();
});
