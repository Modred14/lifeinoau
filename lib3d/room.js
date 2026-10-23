// lib3d/room.js
// The player's room as a little diorama: floor, walls with a window and a door, furniture and the character, on a lawn disc.
// The two walls nearest the camera drop away so you always see in. Browser only.
//
//   const room = createRoomScene(container, { onSelect(id|null), onMove(id, {x, z, rot}), onReady() });
//   room.setRoom({ w, d, theme }); room.setItems(items); room.setAvatar(look, gender); room.setMode("home" | "buy");
//
// Sleep callbacks: onAsleep(id) the character is lying on the bed; onAwake() it is standing again beside the bed;
// onWakeTap() the player tapped the floor to get up (the get-up has already started); onSleepCancel() the player tapped the
// floor while the character was still walking to the bed.
import * as THREE from "three";
import { createStage } from "./stage.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { createIdleController, IDLE_DELAY } from "./avatar/idleEmote.js";
import { buildFurniture, setGlow, posterTex } from "./furnitureModels.js";
import {
  THEMES,
  fits,
  blockedCells,
  findPath,
  spawnCell,
  cellsOf,
} from "../lib/room.js";
import { sizeOf, isOutdoor } from "../lib/furniture.js";
import { layoutOf, wallRuns, zoneAt } from "../lib/layouts.js";

const WALL_H = 3.4, // rooms are about twice the floor area they were, so the walls (the ceiling line) rise a little with them
  CUT = 0.09,
  UNIT_HEIGHT = 1.95; // a person is ~1.95 cells tall (a cell is about 0.9 m)
const DIRS = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
const easeOutBack = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const lerpAngle = (a, b, k) => {
  let d =
    ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) -
    Math.PI;
  return a + d * k;
};
const mat = (color, o = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });

function dispose(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) m.dispose?.();
  });
}

// floors of the wet rooms and the hall in a home with several rooms: cool tiles in the kitchen, bathroom and toilet, pale ones in the hall
const ZONE_TILE = { kitchen: ["#c3c7c9", "#b6bbbf"], bath: ["#c8ced6", "#bcc3cc"], toilet: ["#c8ced6", "#bcc3cc"], passage: ["#ece6d9", "#e2dbcb"] };
function floorTexture(W, D, theme, wood, kindAt) {
  const S = 64,
    c = document.createElement("canvas");
  c.width = W * S;
  c.height = D * S;
  const g = c.getContext("2d");
  let seed = 17;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < W; i++)
    for (let j = 0; j < D; j++) {
      const tint = kindAt && ZONE_TILE[kindAt(i, j)], wooden = wood && !tint;
      g.fillStyle = (i + j) % 2 ? (tint?.[0] ?? theme.floorA) : (tint?.[1] ?? theme.floorB);
      g.fillRect(i * S, j * S, S, S);
      if (wooden) {
        for (let p = 0; p < 4; p++) {
          g.fillStyle = `rgba(${r() > 0.5 ? "255,235,200" : "60,30,10"},${0.05 + r() * 0.07})`;
          g.fillRect(i * S, j * S + p * (S / 4), S, S / 4);
          g.fillStyle = "rgba(60,30,10,.25)";
          g.fillRect(i * S, j * S + p * (S / 4), S, 1.5);
        }
      } else {
        g.strokeStyle = "rgba(0,0,0,.09)";
        g.lineWidth = 2;
        g.strokeRect(i * S + 1, j * S + 1, S - 2, S - 2);
        for (let k = 0; k < 14; k++) {
          g.fillStyle = `rgba(${r() > 0.5 ? "255,255,255" : "70,60,50"},.1)`;
          g.fillRect(
            i * S + r() * S,
            j * S + r() * S,
            2 + r() * 3,
            2 + r() * 3,
          );
        }
      }
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// where a spot `at` (in cells along a wall, 0 to its length) sits in that wall's own frame (see buildRoom)
const wallX = (side, at, W, D) => ({ N: at - W / 2, S: W / 2 - at, W: D / 2 - at, E: at - D / 2 })[side];

function windowDecor(theme, w = 1.3, h = 1.25) {
  const g = new THREE.Group(),
    frame = mat(theme.trim, { roughness: 0.5 });
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      color: "#bfe6ff",
      emissive: "#a8dcff",
      emissiveIntensity: 1.1,
      roughness: 0.2,
    }),
  );
  glass.position.set(0, h / 2, 0.012);
  g.add(glass);
  for (const [bw, bh, x, y] of [
    [w + 0.16, 0.08, 0, 0.04 - 0.04],
    [w + 0.16, 0.08, 0, h - 0.0],
    [0.08, h, -w / 2 - 0.04, h / 2],
    [0.08, h, w / 2 + 0.04, h / 2],
    [0.05, h, 0, h / 2],
    [w, 0.05, 0, h / 2],
  ]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.08), frame);
    b.position.set(x, y, 0.04);
    b.castShadow = true;
    g.add(b);
  }
  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.34, 0.06, 0.2),
    frame,
  );
  sill.position.set(0, -0.03, 0.1);
  g.add(sill);
  for (const s of [-1, 1]) {
    const cur = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, h + 0.3, 0.06),
      mat(theme.accent, { roughness: 0.95 }),
    );
    cur.position.set(s * (w / 2 + 0.28), h / 2 + 0.05, 0.12);
    cur.castShadow = true;
    g.add(cur);
  }
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, w + 0.9, 8),
    mat("#2b2f3a"),
  );
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, h + 0.2, 0.12);
  g.add(rod);
  return g;
}
function doorDecor(theme) {
  const g = new THREE.Group(),
    wood = mat("#6b4428", { roughness: 0.6 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.88, 2.2, 0.07), wood);
  door.position.set(0, 1.1, 0.035);
  door.castShadow = true;
  g.add(door);
  for (const [w, h, x, y] of [
    [0.96, 0.07, 0, 2.23],
    [0.07, 2.27, -0.5, 1.13],
    [0.07, 2.27, 0.5, 1.13],
  ]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), mat(theme.trim));
    b.position.set(x, y, 0.04);
    g.add(b);
  }
  for (const y of [0.55, 1.65]) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.7, 0.02),
      mat("#7d5333", { roughness: 0.5 }),
    );
    p.position.set(0, y, 0.08);
    g.add(p);
  }
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 10),
    mat("#e8c46a", { metalness: 0.8, roughness: 0.3 }),
  );
  knob.position.set(0.32, 1.1, 0.1);
  g.add(knob);
  const mat_ = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.02, 0.5),
    mat(theme.accent, { roughness: 1 }),
  );
  mat_.position.set(0, 0.01, 0.4);
  g.add(mat_); // welcome mat
  return g;
}
function acDecor() {
  const g = new THREE.Group(),
    body = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.34, 0.26),
      mat("#f4f6f8", { roughness: 0.4 }),
    );
  body.position.set(0, 0, 0.13);
  body.castShadow = true;
  g.add(body);
  const vent = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.04, 0.04),
    mat("#cfd6dd"),
  );
  vent.position.set(0, -0.12, 0.25);
  g.add(vent);
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.03, 0.01),
    new THREE.MeshStandardMaterial({
      color: "#4aa8ff",
      emissive: "#4aa8ff",
      emissiveIntensity: 1.5,
    }),
  );
  led.position.set(0.4, 0.06, 0.265);
  g.add(led);
  return g;
}
function posterDecor(n, theme) {
  const g = new THREE.Group(),
    frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.78, 0.05),
      mat("#1d2128"),
    );
  frame.position.z = 0.025;
  frame.castShadow = true;
  g.add(frame);
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 0.7),
    new THREE.MeshStandardMaterial({ map: posterTex(n), roughness: 0.6 }),
  );
  art.position.z = 0.052;
  g.add(art);
  return g;
}
function clockDecor(theme) {
  const g = new THREE.Group(),
    face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.05, 28),
      mat("#fff"),
    );
  face.rotation.x = Math.PI / 2;
  face.position.z = 0.03;
  g.add(face);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.02, 8, 28),
    mat(theme.accent),
  );
  rim.position.z = 0.056;
  g.add(rim);
  for (const [l, a] of [
    [0.13, 0.6],
    [0.09, -1.2],
  ]) {
    const h = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, l, 0.01),
      mat("#1d2128"),
    );
    h.geometry.translate(0, l / 2, 0);
    h.rotation.z = a;
    h.position.z = 0.062;
    g.add(h);
  }
  return g;
}

function tree(kind, seed) {
  const g = new THREE.Group();
  if (kind === "palm") {
    const lean = 0.12 + (seed % 3) * 0.05,
      trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.16, 2.6, 8),
        mat("#8a6a45"),
      );
    trunk.position.y = 1.3;
    trunk.rotation.z = lean;
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new THREE.Group();
    crown.position.set(-Math.sin(lean) * 2.6, 2.55, 0);
    g.add(crown);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 1.7, 4),
        mat(i % 2 ? "#2f9d63" : "#46b97a"),
      );
      leaf.scale.z = 0.25;
      leaf.geometry.translate(0, 0.85, 0);
      leaf.rotation.set(0, (i / 7) * Math.PI * 2, 1.15);
      const a = new THREE.Group();
      a.rotation.y = (i / 7) * Math.PI * 2;
      leaf.rotation.set(0, 0, 1.25);
      a.add(leaf);
      a.castShadow = true;
      crown.add(a);
      leaf.castShadow = true;
    }
  } else {
    for (const [x, y, z, r, c] of [
      [0, 0.32, 0, 0.42, "#3f9a64"],
      [0.36, 0.24, 0.1, 0.3, "#52b176"],
      [-0.3, 0.22, -0.1, 0.28, "#2f8553"],
    ]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat(c));
      b.position.set(x, y, z);
      b.scale.y = 0.85;
      b.castShadow = true;
      g.add(b);
    }
  }
  return g;
}

export function createRoomScene(container, cb = {}) {
  const stage = createStage(container, {
    alpha: true,
    fov: 26,
    exposure: 1.12,
    controls: {
      enablePan: false,
      enableDamping: true,
      dampingFactor: 0.09,
      rotateSpeed: 0.55,
      zoomSpeed: 0.6,
      minPolarAngle: 0.72,
      maxPolarAngle: 1.22,
    },
  });
  const { scene, camera, controls, renderer } = stage;
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  const el = renderer.domElement;

  // light
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x56627f, 1.05));
  const sun = new THREE.DirectionalLight(0xffefd2, 2.5);
  sun.position.set(7, 11, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x9db6ff, 0.55);
  fill.position.set(-6, 5, -4);
  scene.add(fill);
  const lamp = new THREE.PointLight(0xffc98a, 14, 12, 1.7);
  lamp.position.set(0, 2.5, 0);
  scene.add(lamp);

  const world = new THREE.Group(),
    itemsRoot = new THREE.Group(),
    avRoot = new THREE.Group();
  scene.add(world, itemsRoot, avRoot);
  const marker = new THREE.Group(),
    markerFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: "#3fd08a",
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    ),
    markerEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: "#3fd08a" }),
    );
  markerFill.rotation.x = markerEdge.rotation.x = -Math.PI / 2;
  markerFill.position.y = 0.03;
  markerEdge.position.y = 0.035;
  marker.add(markerFill, markerEdge);
  marker.visible = false;
  scene.add(marker);
  const tap = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.28, 28),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  tap.rotation.x = -Math.PI / 2;
  tap.position.y = 0.04;
  scene.add(tap);

  let builtShape = "",
    room = null,
    theme = null,
    W = 0,
    D = 0,
    mode = "home",
    selectedId = null,
    disposed = false,
    tapT = 9,
    userZoomed = false,
    fitDist = 14;
  const walls = {},
    trees = [],
    items = new Map(),
    toolbar = { el: null },
    fans = [];
  let av = null,
    avTicket = 0;
  const me = {
    x: 0,
    z: 0,
    yaw: 0.8,
    path: [],
    moving: false,
    wantedFace: null,
  };
  const cellWorld = (cx, cz) => [cx + 0.5 - W / 2, cz + 0.5 - D / 2];
  // a bigger room means a longer walk: the pace rises a little with the size (up to a third faster) so crossing it never drags; the 8x6 room's pace is the base
  const walkSpeed = () => 1.9 * Math.min(1.7, Math.max(1, Math.hypot(W, D) / 12));
  const placedList = () =>
    [...items.values()].map((i) => ({ ...i.data, placed: true }));

  // ----- the room shell -----
  function buildRoom() {
    for (const k of Object.keys(walls)) delete walls[k];
    trees.length = 0;
    fans.length = 0;
    while (world.children.length) {
      const c = world.children[0];
      world.remove(c);
      dispose(c);
    }
    theme = THEMES[room.theme] ?? THEMES.sage;
    const grime = room.grime ?? 0, dirty = (hex, k, to) => "#" + new THREE.Color(hex).lerp(new THREE.Color(to), k).getHexString();
    if (grime > 0.05) theme = { ...theme, wall: dirty(theme.wall, grime * 0.4, "#6e6552"), floorA: dirty(theme.floorA, grime * 0.3, "#4f483d"), floorB: dirty(theme.floorB, grime * 0.3, "#4f483d") }; // paint dulls and floors darken
    W = room.w;
    D = room.d;
    const L = layoutOf(room), R = Math.hypot(W, D) / 2 + 1.6; // a wide lawn: the generator stands on it, outside the east wall
    const lawn = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R + 0.12, 0.5, 72),
      mat("#8fb592", { roughness: 1 }),
    );
    lawn.position.y = -0.62;
    lawn.receiveShadow = true;
    world.add(lawn);
    const lawnTop = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.15, R - 0.15, 0.02, 72),
      mat("#a3c9a3", { roughness: 1 }),
    );
    lawnTop.position.y = -0.36;
    lawnTop.receiveShadow = true;
    world.add(lawnTop);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.04, 0.05, 8, 96),
      mat("#d9ecd5", { roughness: 0.8 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.37;
    world.add(rim);
    // floor
    const tex = floorTexture(W, D, theme, room.theme === "wood", L && ((i, j) => zoneAt(L, i, j)?.kind)),
      side = mat(theme.floorB, { roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.34, D), [
      side,
      side,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }),
      side,
      side,
      side,
    ]);
    floor.position.y = -0.17;
    floor.receiveShadow = true;
    world.add(floor);
    // a rough room: floor stains, litter and a bin bag, more of each the rougher it is
    if (grime > 0.2) {
      let seed = Math.round(W * 131 + D * 17), rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const at = (m) => [(rnd() - 0.5) * (W - 0.8), (rnd() - 0.5) * (D - 0.8)];
      for (let i = 0, n = Math.round(grime * 14); i < n; i++) { const [x, z] = at(), s = new THREE.Mesh(new THREE.CircleGeometry(0.15 + rnd() * 0.4, 14), new THREE.MeshBasicMaterial({ color: "#2f261b", transparent: true, opacity: 0.18 + rnd() * 0.22, depthWrite: false })); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.012, z); world.add(s); }
      for (let i = 0, n = Math.round(grime * 16); i < n; i++) { const [x, z] = at(), k = i % 3, c = ["#e9e5d8", "#3c8f5a", "#4a78c8"][k],
          m = k === 0 ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + rnd() * 0.03, 0), mat(c, { roughness: 1 })) : k === 1 ? new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 8), mat(c, { roughness: 0.4 })) : new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.09), mat(c, { roughness: 0.8 }));
        m.position.set(x, k === 1 ? 0.03 : 0.04, z); if (k === 1) m.rotation.z = Math.PI / 2; m.rotation.y = rnd() * 6; m.castShadow = true; world.add(m); }
      if (grime > 0.55) { const bag = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mat("#1d2026", { roughness: 0.5 })); bag.scale.set(1, 0.85, 0.9); bag.position.set(W / 2 - 0.55, 0.24, -D / 2 + 0.5); bag.castShadow = true; world.add(bag); const knot = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), mat("#1d2026")); knot.position.set(W / 2 - 0.55, 0.55, -D / 2 + 0.5); world.add(knot); }
    }
    // walls: each is a group standing on the floor edge, local +z points into the room
    const defs = {
      N: [0, -D / 2, 0, W + 0.48],
      S: [0, D / 2, Math.PI, W + 0.48],
      W: [-W / 2, 0, Math.PI / 2, D],
      E: [W / 2, 0, -Math.PI / 2, D],
    };
    for (const [k, [x, z, rot, len]] of Object.entries(defs)) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      world.add(g);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(len, WALL_H, 0.24),
        mat(theme.wall, { roughness: 0.92 }),
      );
      body.position.set(0, WALL_H / 2, -0.12);
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(len + 0.02, 0.07, 0.28),
        mat(theme.trim, { roughness: 0.6 }),
      );
      cap.position.set(0, WALL_H - 0.035, -0.12);
      g.add(cap);
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(
          len - (k === "N" || k === "S" ? 0.48 : 0),
          0.16,
          0.04,
        ),
        mat(theme.trim, { roughness: 0.6 }),
      );
      base.position.set(0, 0.08, 0.02);
      g.add(base);
      const decor = new THREE.Group();
      g.add(decor);
      walls[k] = { g, decor, s: 1 };
    }
    // decor, in each wall's own frame: x runs along the wall (for the west wall x grows towards the north)
    const place = (wall, obj, x, y) => {
      obj.position.set(x, y, 0);
      walls[wall].decor.add(obj);
    };
    if (L) {
      // a home with several rooms: low walls between the rooms (so you can always see in), doorways left open, windows and the front door
      const INNER = 0.8, wallMat = mat(theme.wall, { roughness: 0.92 }), capMat = mat(theme.trim, { roughness: 0.6 });
      const { walls: runs, doors } = wallRuns(L);
      for (const r of runs) {
        const horiz = r.z1 === r.z2, len = (horiz ? r.x2 - r.x1 : r.z2 - r.z1) + 0.12, cx = (r.x1 + r.x2) / 2 - W / 2, cz = (r.z1 + r.z2) / 2 - D / 2;
        const g = new THREE.Group();
        g.position.set(cx, 0, cz);
        if (!horiz) g.rotation.y = Math.PI / 2;
        const body = new THREE.Mesh(new THREE.BoxGeometry(len, INNER, 0.12), wallMat);
        body.position.y = INNER / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.01, 0.05, 0.16), capMat);
        cap.position.y = INNER - 0.025;
        g.add(body, cap);
        world.add(g);
      }
      for (const dr of doors) { // a threshold strip across each doorway
        const th = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.16), capMat);
        th.position.set(dr.x - W / 2, 0.01, dr.z - D / 2);
        if (dr.dir === "v") th.rotation.y = Math.PI / 2;
        world.add(th);
      }
      for (const w of L.windows) place(w.side, windowDecor(theme, w.w, w.h), wallX(w.side, w.at, W, D), w.y ?? 0.95);
      for (const d of L.decor) place(d.side, d.kind === "ac" ? acDecor() : d.kind === "clock" ? clockDecor(theme) : posterDecor(d.n ?? 0, theme), wallX(d.side, d.at, W, D), d.y ?? 1.55);
      place("S", doorDecor(theme), wallX("S", L.entry.at, W, D), 0);
    } else {
    place("N", windowDecor(theme), W * 0.2, 0.95);
    place("N", acDecor(), -W * 0.2, 2.45);
    place("N", posterDecor(0, theme), -W * 0.02, 1.55);
    place("N", clockDecor(theme), W * 0.02 + 0.9, 2.45);
    place("W", doorDecor(theme), -(D - 1) / 2, 0);
    place("W", windowDecor(theme, 1.1, 1.1), D * 0.18, 1.0);
    place("W", posterDecor(1, theme), -D * 0.12, 1.6);
    place("E", windowDecor(theme, 1.3, 1.25), -D * 0.1, 0.95);
    place("E", posterDecor(2, theme), D * 0.2, 1.6);
    place("E", acDecor(), D * 0.32, 2.45);
    place("S", windowDecor(theme, 1.5, 1.2), -W * 0.15, 0.95);
    place("S", posterDecor(3, theme), W * 0.2, 1.6);
    place("S", clockDecor(theme), W * 0.32, 2.4);
    // the walls are long now: a second window on the north, south and east walls (clear of the curtains and fittings already there), so none of them looks bare
    place("N", windowDecor(theme), -W * 0.36, 0.95);
    place("S", windowDecor(theme, 1.3, 1.2), -W * 0.36, 0.95);
    place("E", windowDecor(theme, 1.3, 1.25), -D * 0.35, 0.95);
    }
    // the lawn around the room
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2,
        rr = R - 0.32 - (i % 3) * 0.1,
        kind = i % 5 === 0 ? "palm" : "bush",
        t = tree(kind, i);
      t.position.set(Math.cos(a) * rr, -0.35, Math.sin(a) * rr);
      t.rotation.y = a * 3;
      world.add(t);
      trees.push({ g: t, a, kind, s: 1 });
    }
    // light and camera framing for this size
    const sc = Math.max(W, D) * 0.75 + 2;
    Object.assign(sun.shadow.camera, {
      left: -sc,
      right: sc,
      top: sc,
      bottom: -sc,
      near: 1,
      far: 40,
    });
    sun.shadow.camera.updateProjectionMatrix();
    const span = Math.hypot(W, D); // one lamp in the middle: its reach and strength grow with the room so the far corners are not left dim
    lamp.position.set(0, WALL_H - 0.55, 0);
    lamp.distance = Math.max(12, span * 0.95);
    lamp.intensity = 14 * Math.max(1, Math.sqrt((W * D) / 48));
    itemsRoot.position.set(0, 0, 0);
    const shape = `${W}x${D}:${room.layout ?? ""}`;
    if (shape !== builtShape) { // a different home: the character walks in again
      builtShape = shape;
      me.placed = false;
      spawn();
    }
    fit(true);
  }

  // ----- camera -----
  function fit(reset) {
    if (!room) return;
    const w = container.clientWidth || 1,
      h = container.clientHeight || 1,
      aspect = w / h,
      vf = THREE.MathUtils.degToRad(camera.fov),
      hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const r = Math.hypot(W, D) / 2 + 1.1;
    fitDist = Math.max(r / Math.sin(vf / 2), r / Math.sin(hf / 2)) * 1.0;
    controls.minDistance = fitDist * 0.5;
    controls.maxDistance = fitDist * 1.35;
    controls.target.set(0, 0.6, 0);
    if (reset || !userZoomed) {
      const off = camera.position.clone().sub(controls.target);
      const sp = new THREE.Spherical();
      if (reset && off.length() < 0.01) off.set(1, 1, 1);
      sp.setFromVector3(off);
      if (reset) {
        sp.theta = Math.PI / 4;
        sp.phi = 0.98;
      }
      sp.radius = fitDist;
      camera.position.copy(controls.target).add(off.setFromSpherical(sp));
      controls.update();
    }
  }
  const ro = new ResizeObserver(() => fit(false));
  ro.observe(container);
  controls.addEventListener("start", () => {
    userZoomed = true;
  });
  let spinLeft = 0;
  function rotateView(dir) {
    spinLeft += dir * (Math.PI / 2);
  }

  // ----- furniture -----
  const targetOf = (d) => {
    const [w, dd] = sizeOf(d.key, d.rot),
      [x, z] = [d.x + w / 2 - W / 2, d.z + dd / 2 - D / 2];
    return { x, z, yaw: (-d.rot * Math.PI) / 2 };
  };
  function addItem(d, animate) {
    const group = buildFurniture(d.key),
      y0 = isOutdoor(d.key) ? -0.3 : 0; // outdoor things stand on the lawn, below the floor, on a little concrete pad
    group.userData.itemId = String(d.id);
    if (y0) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.9), mat("#bdb8ab", { roughness: 1 }));
      pad.position.y = -0.04;
      pad.receiveShadow = true;
      group.add(pad);
    }
    itemsRoot.add(group);
    const t = targetOf(d);
    group.position.set(t.x, y0, t.z);
    group.rotation.y = t.yaw;
    if (group.userData.spin) fans.push(group.userData.spin);
    const it = {
      data: d,
      group,
      t,
      age: animate ? 0 : 1,
      lift: 0,
      y0,
      shake: 0,
      leaving: 0,
    };
    if (animate) group.scale.setScalar(0.001);
    items.set(String(d.id), it);
    return it;
  }
  function setItems(list) {
    const want = new Map(
      list.filter((i) => i.placed && i.x != null).map((i) => [String(i.id), i]),
    );
    for (const [id, it] of items)
      if (!want.has(id)) {
        it.leaving = 0.0001;
        if (selectedId === id) select(null, true);
      }
    for (const [id, d] of want) {
      const have = items.get(id);
      if (have && !have.leaving) {
        have.data = d;
        have.t = targetOf(d);
      } else if (!have) addItem(d, !firstItems);
    }
    firstItems = false;
    keepAvatarFree();
    updateMarker();
  }
  let firstItems = true;
  function select(id, silent) {
    id = id == null ? null : String(id);
    if (selectedId === id) return;
    const old = items.get(selectedId);
    if (old) setGlow(old.group, false);
    selectedId = id;
    const it = items.get(id);
    if (it) setGlow(it.group, true);
    updateMarker();
    if (!silent) cb.onSelect?.(id);
  }
  function updateMarker(override) {
    const it = items.get(selectedId);
    if (!it || mode !== "buy") {
      marker.visible = false;
      return;
    }
    const d = override ?? it.data,
      [w, dd] = sizeOf(d.key, d.rot),
      ok = override ? override.ok : true,
      col = ok ? "#3fd08a" : "#ff6b6b";
    marker.visible = true;
    marker.scale.set(w, 1, dd);
    marker.position.set(d.x + w / 2 - W / 2, 0, d.z + dd / 2 - D / 2);
    markerFill.material.color.set(col);
    markerEdge.material.color.set(col);
    markerFill.scale.set(1, 1, 1);
  }
  function rotateSelected() {
    const it = items.get(selectedId);
    if (!it) return false;
    const d = it.data,
      rot = (d.rot + 1) % 4,
      [w0, d0] = sizeOf(d.key, d.rot),
      [w1, d1] = sizeOf(d.key, rot),
      bx = d.x + Math.round((w0 - w1) / 2),
      bz = d.z + Math.round((d0 - d1) / 2);
    for (const [sx, sz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      if (fits(room, placedList(), d.key, bx + sx, bz + sz, rot, d.id)) {
        commit(it, { x: bx + sx, z: bz + sz, rot });
        return true;
      }
    }
    it.shake = 0.4;
    return false;
  }
  function commit(it, p) {
    it.data = { ...it.data, ...p };
    it.t = targetOf(it.data);
    updateMarker();
    cb.onMove?.(it.data.id, p);
  }
  function pulse(id) {
    const it = items.get(String(id));
    if (it) {
      it.age = 0;
      it.group.scale.setScalar(0.001);
    }
  }

  // ----- sleeping: walk to the bed, sit on it, lie down. To wake: sit up, stand, then walk to where the player tapped -----
  // There is no sit animation in the avatar library, so sitting is the normal idle pose lowered onto the bed and leaned back a little
  // (the legs are inside the mattress). Every step is a smooth blend, so the character never jumps from one place to another.
  const USE_KIND = { iron_bunk: "bed", single_bed: "bed", double_bed: "bed", nightstand: "phone", desk: "phone" };
  const BED_TOP = { iron_bunk: 0.5, single_bed: 0.62, double_bed: 0.62 }; // height of the mattress top, from the furniture models
  const HIP = 1.0, SIT_TILT = 0.3; // hip height of the character, and how far its back leans when sitting up (radians)
  const ease = (x) => x * x * (3 - 2 * x);
  const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k), th: a.th + (b.th - a.th) * k });
  /** Where the character goes when its body is tipped back by `th` (0 = upright, PI/2 = flat on its back) with the hips resting on the mattress. */
  function bedPose(it, th) {
    const t = it.t ?? targetOf(it.data), back = UNIT_HEIGHT - 0.85 - HIP + HIP * Math.sin(th);
    return { x: t.x + Math.sin(t.yaw) * back, z: t.z + Math.cos(t.yaw) * back, y: (BED_TOP[it.data.key] ?? 0.6) + 0.12 - HIP * Math.cos(th), yaw: t.yaw, th };
  }
  function sleepStep(dt) {
    const s = me.sleep; if (!s) return;
    const adv = (secs, next) => { s.t += dt / secs; if (s.t >= 1) { s.t = 0; s.stage = next; return true; } return false; };
    switch (s.stage) {
      case "walk": if (!me.path.length && !me.moving) { s.stage = "sit"; s.t = 0; } break; // arrived beside the bed
      case "sit": adv(0.9, "settle"); break;
      case "settle": adv(0.5, "lie"); break;
      case "lie": if (adv(1.1, "asleep")) cb.onAsleep?.(s.id); break;
      case "up": adv(1.0, "rest"); break; // lying -> sitting
      case "rest": adv(0.5, "stand"); break;
      case "stand": if (adv(0.9, "done")) finishWake(); break; // sitting -> standing beside the bed
    }
  }
  function finishWake() {
    const tg = me.sleep?.target; me.sleep = null; avRoot.rotation.x = 0;
    cb.onAwake?.();
    if (tg) walkTo(tg[0], tg[1]); // then walk to where the player tapped
  }
  function applySleepPose() {
    const s = me.sleep; avRoot.rotation.order = "YXZ";
    if (!s || s.stage === "walk") { avRoot.rotation.x = 0; return; }
    const it = items.get(s.id); if (!it) { me.sleep = null; avRoot.rotation.x = 0; return; }
    const sit = bedPose(it, SIT_TILT), stand = { x: me.x, y: 0, z: me.z, yaw: me.yaw, th: 0 }, k = ease(Math.min(1, s.t)), span = Math.PI / 2 - SIT_TILT;
    const p = s.stage === "sit" ? mix(stand, sit, k)
      : s.stage === "settle" || s.stage === "rest" ? sit
      : s.stage === "lie" ? bedPose(it, SIT_TILT + span * k)
      : s.stage === "up" ? bedPose(it, Math.PI / 2 - span * k)
      : s.stage === "stand" ? mix(sit, stand, k)
      : bedPose(it, Math.PI / 2); // asleep
    avRoot.position.set(p.x, p.y, p.z); avRoot.rotation.y = p.yaw; avRoot.rotation.x = -p.th;
  }
  /** Walk to the bed, then sit and lie down. Returns false if there is no such bed or no character yet. */
  function goToBed(id) {
    const it = items.get(String(id)); if (!it || !av || me.sleep || USE_KIND[it.data.key] !== "bed") return false;
    me.sleep = { id: String(id), stage: "walk", t: 0, target: null };
    const t = it.t ?? targetOf(it.data); walkTo(Math.floor(t.x + W / 2), Math.floor(t.z + D / 2)); // the bed is blocked, so this lands on the nearest free cell beside it
    return true;
  }
  /** Already asleep when the page opened (the server says so): lie in the bed straight away, no walk. */
  function lieInBed(id) {
    const it = items.get(String(id)); if (!it || !av) return false;
    const t = it.t ?? targetOf(it.data), c = nearestFree([Math.floor(t.x + W / 2), Math.floor(t.z + D / 2)], blocked()), [x, z] = cellWorld(...c);
    me.x = x; me.z = z; me.path = []; me.sleep = { id: String(id), stage: "asleep", t: 1, target: null };
    return true;
  }
  /** Sit up, stand, then (if `cell` is given) walk to that cell. Does nothing unless the character is lying asleep or already getting up. */
  function wakeUp(cell) {
    const s = me.sleep; if (!s) return false;
    if (s.stage === "asleep") { me.sleep = { ...s, stage: "up", t: 0, target: cell ?? null }; return true; }
    if (s.stage === "up" || s.stage === "rest" || s.stage === "stand") { if (cell) s.target = cell; return true; } // already getting up: just change where to go
    return false;
  }
  /** Stop going to bed while the character is still walking to it. */
  function cancelSleep() { if (me.sleep?.stage !== "walk") return false; me.sleep = null; me.path = []; return true; }

  // ----- the character -----
  const blocked = () => blockedCells(placedList());
  const cellOf = () => [
    Math.min(W - 1, Math.max(0, Math.floor(me.x + W / 2))),
    Math.min(D - 1, Math.max(0, Math.floor(me.z + D / 2))),
  ];
  function nearestFree(from, bl) {
    const seen = new Set([from.join()]),
      q = [from];
    while (q.length) {
      const c = q.shift();
      if (!bl.has(c.join())) return c;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = [c[0] + dx, c[1] + dz];
        if (
          n[0] < 0 ||
          n[1] < 0 ||
          n[0] >= W ||
          n[1] >= D ||
          seen.has(n.join())
        )
          continue;
        seen.add(n.join());
        q.push(n);
      }
    }
    return from;
  }
  function keepAvatarFree() {
    if (!room || !av) return;
    const bl = blocked(),
      c = cellOf();
    if (bl.has(c.join())) {
      const f = nearestFree(c, bl),
        [x, z] = cellWorld(...f);
      me.x = x;
      me.z = z;
      me.path = [];
    }
  }
  function walkTo(cx, cz) {
    if (!room || !av) return;
    const bl = blocked(),
      from = cellOf();
    let to = [cx, cz];
    if (bl.has(to.join())) to = nearestFree(to, bl);
    const path = findPath(room, bl, from, to);
    if (!path.length) return;
    me.path = path;
    const [x, z] = cellWorld(...to);
    tap.position.x = x;
    tap.position.z = z;
    tapT = 0;
  }
  // the character walks in through the front door and goes to the middle of the home
  function spawn() {
    if (!room || !av) return;
    const L = layoutOf(room);
    me.placed = true;
    me.path = [];
    let goal;
    if (L) { // front door in the south wall
      const [x, z] = cellWorld(L.entry.x, L.entry.z);
      me.x = x;
      me.z = z + 1.0;
      me.yaw = Math.PI;
      goal = L.goal;
    } else { // front door in the west wall
      const [x, z] = cellWorld(0, D - 1);
      me.x = x - 0.4;
      me.z = z;
      me.yaw = Math.PI / 2;
      goal = [Math.round(W / 2), Math.round(D / 2)];
    }
    setTimeout(() => !disposed && walkTo(...nearestFree(goal, blocked())), 600); // by then the furniture is in, so it picks a free cell
  }
  async function setAvatar(look, gender) {
    const mine = ++avTicket,
      next = await createAvatar(look, gender);
    if (disposed || mine !== avTicket) {
      next.dispose();
      return;
    }
    if (av) {
      avRoot.remove(av.root);
      av.dispose();
    }
    av = next;
    const k = UNIT_HEIGHT / (av.height || 1.76);
    av.root.scale.multiplyScalar(k);
    av.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    avRoot.add(av.root);
    if (room && !me.placed) spawn();
    me.playing = null;
    idleEmote.reset();
  }

  // ----- idle emote: after IDLE_DELAY seconds of doing nothing the character plays an emote, then blends back to idle -----
  const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const idleEmote = createIdleController({
    delay: IDLE_DELAY,
    canPlay: () => !!av && !document.hidden && !reducedMotion() && me.playing === "idle" && av.has("idleEmote"),
    play: () => {
      if (!av.emote({ onDone: (finished) => { if (finished) { idleEmote.finish(); me.playing = "idle"; } } })) return false; // it blends back to idle by itself
      me.playing = "idleEmote";
    },
    stop: () => { av?.stopEmote(); me.playing = "idle"; },
  });
  // any input anywhere on the page (tap, click, key, scroll) counts as activity; capture phase so UI panels over the room count too
  const poke = () => idleEmote.poke(),
    activity = ["pointerdown", "keydown", "wheel", "touchstart"],
    onVisible = () => { if (document.hidden) poke(); };
  activity.forEach((n) => window.addEventListener(n, poke, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", onVisible);

  // ----- pointer -----
  const ray = new THREE.Raycaster(),
    ndc = new THREE.Vector2(),
    floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    tmp = new THREE.Vector3();
  const aim = (e) => {
    const r = el.getBoundingClientRect();
    ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(ndc, camera);
  };
  const hitItem = () => {
    for (const h of ray.intersectObjects(
      [...items.values()].map((i) => i.group),
      true,
    )) {
      let o = h.object;
      while (o && !o.userData.itemId) o = o.parent;
      if (o) return o.userData.itemId;
    }
    return null;
  };
  const hitFloor = () =>
    ray.ray.intersectPlane(floorPlane, tmp) ? tmp.clone() : null;
  let down = null,
    drag = null;
  container.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || !room) return;
      aim(e);
      const id = hitItem(),
        f = hitFloor();
      down = { x: e.clientX, y: e.clientY, id, moved: false, f };
      if (mode === "buy" && id) {
        const it = items.get(id),
          t = it.t;
        select(id);
        if (isOutdoor(it.data.key)) return; // the generator stays on its lawn spot: you can store or sell it, not drag it into the house
        drag = {
          id,
          offx: (f?.x ?? t.x) - t.x,
          offz: (f?.z ?? t.z) - t.z,
          start: { ...it.data },
          ok: true,
          last: { ...it.data },
          active: false,
        };
        controls.enabled = false;
      }
    },
    true,
  );
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  function onMove(e) {
    if (!down || !room) {
      if (!down && e.target === el && room) {
        aim(e);
        el.style.cursor = mode === "buy" && hitItem() ? "grab" : "";
      }
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6)
      down.moved = true;
    if (!drag || !down.moved) return;
    drag.active = true;
    el.style.cursor = "grabbing";
    aim(e);
    const f = hitFloor();
    if (!f) return;
    const it = items.get(drag.id),
      [w, dd] = sizeOf(it.data.key, it.data.rot);
    const x = Math.min(
        W - w,
        Math.max(0, Math.round(f.x - drag.offx + W / 2 - w / 2)),
      ),
      z = Math.min(
        D - dd,
        Math.max(0, Math.round(f.z - drag.offz + D / 2 - dd / 2)),
      );
    const ok = fits(
      room,
      placedList(),
      it.data.key,
      x,
      z,
      it.data.rot,
      it.data.id,
    );
    drag.last = { ...it.data, x, z, ok };
    it.t = targetOf(drag.last);
    it.lift = 0.18;
    updateMarker(drag.last);
  }
  function onUp(e) {
    if (!down) return;
    const d = down,
      dr = drag;
    down = null;
    drag = null;
    controls.enabled = true;
    el.style.cursor = "";
    if (dr?.active) {
      const it = items.get(dr.id);
      it.lift = 0;
      if (dr.last.ok && (dr.last.x !== dr.start.x || dr.last.z !== dr.start.z))
        commit(it, { x: dr.last.x, z: dr.last.z, rot: it.data.rot });
      else {
        it.data = { ...dr.start };
        it.t = targetOf(it.data);
        if (!dr.last.ok) it.shake = 0.35;
        updateMarker();
      }
      return;
    }
    if (d.moved) return;
    if (mode === "buy") {
      if (d.id) select(d.id);
      else select(null);
      return;
    }
    // tapping the bed or the phone asks the screen what to do (sleep / call home); the screen decides, the server enforces
    const used = d.id && items.get(d.id), kind = used && USE_KIND[used.data.key];
    if (kind) { cb.onUse?.({ id: d.id, key: used.data.key, kind }); return; }
    const onFloor = d.f && Math.abs(d.f.x) < W / 2 && Math.abs(d.f.z) < D / 2,
      cell = onFloor ? [Math.floor(d.f.x + W / 2), Math.floor(d.f.z + D / 2)] : null;
    if (me.sleep) {
      if (!cell) return;
      if (me.sleep.stage === "asleep") { if (wakeUp(cell)) cb.onWakeTap?.(); } // tapped the floor: sit up, stand, walk there
      else if (me.sleep.stage === "walk") { if (cancelSleep()) { cb.onSleepCancel?.(); walkTo(...cell); } } // changed their mind on the way
      else wakeUp(cell); // already getting up: just change where to go (ignored while settling into bed)
      return;
    }
    if (cell) walkTo(...cell);
  }

  // ----- frame -----
  const proj = new THREE.Vector3();
  stage.onFrame((t, dt) => {
    if (!room) return;
    if (Math.abs(spinLeft) > 0.002) {
      const step = spinLeft * (1 - Math.exp(-dt * 7));
      stage.nudge({ az: step });
      spinLeft -= step;
    } else spinLeft = 0;
    const ax = camera.position.x - controls.target.x,
      az = camera.position.z - controls.target.z,
      len = Math.hypot(ax, az) || 1,
      cx = ax / len,
      cz = az / len;
    for (const [k, w] of Object.entries(walls)) {
      const [nx, nz] = DIRS[k],
        to = nx * cx + nz * cz > 0.28 ? CUT : 1;
      w.s += (to - w.s) * (1 - Math.exp(-dt * 9));
      w.g.scale.y = w.s;
      w.decor.visible = w.s > 0.9;
    }
    for (const tr of trees) {
      const to =
        Math.cos(tr.a) * cx + Math.sin(tr.a) * cz > -0.2 && tr.kind === "palm"
          ? 0.001
          : 1;
      tr.s += (to - tr.s) * (1 - Math.exp(-dt * 8));
      tr.g.scale.setScalar(Math.max(0.001, tr.s));
    }
    for (const f of fans) f.rotation.z += dt * 14;
    // furniture glides to its place, pops in when new, shrinks away when gone
    const k = 1 - Math.exp(-dt * 16);
    for (const [id, it] of items) {
      const g = it.group;
      if (it.leaving) {
        it.leaving += dt;
        const s = Math.max(0, 1 - it.leaving / 0.28);
        g.scale.setScalar(Math.max(0.001, s));
        if (s <= 0) {
          itemsRoot.remove(g);
          dispose(g);
          const i = fans.indexOf(g.userData.spin);
          if (i >= 0) fans.splice(i, 1);
          items.delete(id);
        }
        continue;
      }
      if (it.age < 1) {
        it.age = Math.min(1, it.age + dt / 0.7);
        const e = easeOutBack(Math.min(1, it.age * 1.2));
        g.scale.setScalar(Math.max(0.001, e));
        g.position.y = (1 - Math.min(1, it.age * 1.6)) * 1.3 + it.lift + it.y0;
      } else {
        g.position.y += (it.lift + it.y0 - g.position.y) * k;
        if (g.scale.x !== 1) g.scale.setScalar(1);
      }
      g.position.x += (it.t.x - g.position.x) * k;
      g.position.z += (it.t.z - g.position.z) * k;
      g.rotation.y = lerpAngle(g.rotation.y, it.t.yaw, k);
      if (it.shake > 0) {
        it.shake -= dt;
        g.position.x += Math.sin(it.shake * 60) * 0.04 * (it.shake / 0.4);
      }
    }
    // character
    if (av) {
      let moving = false;
      sleepStep(dt);
      if (me.sleep && me.sleep.stage !== "walk") me.path = []; // lying down, asleep or getting up: no walking
      if (me.path.length) {
        const [gx, gz] = cellWorld(...me.path[0]),
          dx = gx - me.x,
          dz = gz - me.z,
          dist = Math.hypot(dx, dz),
          step = walkSpeed() * dt;
        moving = true;
        me.yaw = lerpAngle(me.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12));
        if (dist <= step) {
          me.x = gx;
          me.z = gz;
          me.path.shift();
        } else {
          me.x += (dx / dist) * step;
          me.z += (dz / dist) * step;
        }
      }
      if (!moving && me.moving) me.faceCam = true;
      if (!moving && me.faceCam) {
        me.yaw = lerpAngle(me.yaw, Math.atan2(cx, cz), 1 - Math.exp(-dt * 5));
      }
      me.moving = moving;
      if (moving) me.faceCam = false;
      avRoot.position.set(me.x, 0, me.z);
      avRoot.rotation.y = me.yaw;
      applySleepPose();
      const want = moving && av.has("walk") ? "walk" : "idle";
      // busy = walking, a finger/mouse held down, dragging furniture, or shopping/arranging; any of these stops the countdown and a running emote
      idleEmote.update(dt, moving || !!down || !!drag || mode !== "home" || selectedId != null || !!me.sleep);
      if (me.playing !== want && !(want === "idle" && idleEmote.playing)) {
        me.playing = want;
        av.play(want);
      }
      av.update(t, dt);
    }
    if (tapT < 1) {
      tapT += dt * 1.6;
      tap.material.opacity = (1 - tapT) * 0.9;
      tap.scale.setScalar(1 + tapT * 0.9);
    } else tap.material.opacity = 0;
    if (marker.visible) {
      const p = 0.28 + Math.sin(t * 4) * 0.06;
      markerFill.material.opacity = drag?.active ? 0.42 : p;
    }
    // the little tool bar follows the selected piece
    const te = toolbar.el,
      sel = items.get(selectedId);
    if (te) {
      if (sel && mode === "buy" && !drag?.active) {
        const [w, dd] = sizeOf(sel.data.key, sel.data.rot);
        proj
          .set(
            sel.group.position.x,
            1.5 + Math.max(w, dd) * 0.1,
            sel.group.position.z,
          )
          .project(camera);
        const r = container.getBoundingClientRect(),
          x = (proj.x * 0.5 + 0.5) * r.width,
          y = (-proj.y * 0.5 + 0.5) * r.height;
        te.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        te.dataset.on = "1";
      } else te.dataset.on = "0";
    }
  });

  function setMode(m) {
    mode = m;
    if (m !== "buy") {
      select(null);
      marker.visible = false;
    }
    updateMarker();
  }
  function setRoom(r) {
    const changed =
      !room || room.w !== r.w || room.d !== r.d || room.theme !== r.theme || room.layout !== r.layout || (room.grime ?? 0) !== (r.grime ?? 0);
    room = r;
    if (changed) {
      buildRoom();
      cb.onReady?.();
    }
  }
  return {
    setRoom,
    setItems,
    setAvatar,
    setMode,
    select,
    rotateView,
    rotateSelected,
    pulse,
    walkTo,
    goToBed,
    lieInBed,
    wakeUp,
    cancelSleep,
    isAsleep: () => me.sleep?.stage === "asleep",
    isSleepBusy: () => !!me.sleep,
    attachToolbar: (e) => {
      toolbar.el = e;
    },
    getSelected: () => selectedId,
    resize: () => stage.resize(),
    dispose() {
      disposed = true;
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      activity.forEach((n) => window.removeEventListener(n, poke, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible);
      av?.dispose();
      dispose(world);
      dispose(itemsRoot);
      stage.dispose();
    },
  };
}