import * as THREE from "three";
import { PX_PER_METER, SOCIAL_SITES, liveEvent, type GameTime } from "@campuslife/shared";
import { boxAt, mergeParts, yawOf } from "../interior/kit";
import { disposeLabel, makeLabel } from "../labels";

export interface SocialProps {
  group: THREE.Group;
  update(focus: THREE.Vector3, t: GameTime, minutes: number): void;
  dispose(): void;
}

const M = PX_PER_METER;
const CULL_M = 170;
const LABEL_M = 70;
const SKIN = 0x6f4630;
const SHIRT = 0xf8fafc;
const INK = [0xc62828, 0x1565c0, 0x2e7d32, 0x6a1b9a, 0xef6c00, 0x111111];
const DRUM = { skin: 0xe8d9b5, wood: 0x7a4a2b, keg: 0xd9c9a3 };
const MEMBERS = [0x3f6212, 0x1f2937, 0x7c2d12, 0x1e3a8a, 0x4a044e, 0x374151];
const CANOPY = { cloth: 0xf4f1e6, pole: 0x8a9096, table: 0x9a7048, pot: 0x2a2b2e, rice: 0xd9662b };
const LABEL_STYLE = { screenHeight: 0.026, background: "rgba(63,98,18,0.92)", color: "#ffffff" };
const TEXT = { gyration: "Kegites gyration", games: "Union Week: jollof and games" };
const CANOPY_SOUTH_M = 1.5;
const DRUMMERS = 3;
const CIRCLE = 5;
const BEAT = 6;

export function buildSocialProps(): SocialProps {
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const labels: THREE.Sprite[] = [];
  const keep = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const mat = (color: number) => keep(new THREE.MeshLambertMaterial({ color }));
  const tinted = keep(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const skin = mat(SKIN);
  const bodyGeo = keep(mergeParts([boxAt(0.38, 0.6, 0.22, 0, 0.8, 0), boxAt(0.32, 0.8, 0.18, 0, 0, 0)]));
  const headGeo = keep(boxAt(0.2, 0.22, 0.2, 0, 1.42, 0));
  const scribbleGeo = keep(mergeParts([boxAt(0.16, 0.03, 0.01, -0.06, 1.25, 0.115), boxAt(0.12, 0.03, 0.01, 0.08, 1.12, 0.115), boxAt(0.2, 0.03, 0.01, 0, 0.98, 0.115, 0.3), boxAt(0.18, 0.03, 0.01, 0.02, 1.2, -0.115), boxAt(0.14, 0.03, 0.01, -0.05, 1.02, -0.115)]));
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  const label = (text: string, x: number, z: number) => {
    const sprite = makeLabel(text, LABEL_STYLE);
    sprite.position.set(x, 3.2, z);
    sprite.visible = false;
    root.add(sprite);
    labels.push(sprite);
    return sprite;
  };
  const people = (count: number): { bodies: THREE.InstancedMesh; heads: THREE.InstancedMesh } => {
    const bodies = keep(new THREE.InstancedMesh(bodyGeo, tinted, Math.max(1, count)));
    const heads = keep(new THREE.InstancedMesh(headGeo, skin, Math.max(1, count)));
    bodies.frustumCulled = false;
    heads.frustumCulled = false;
    return { bodies, heads };
  };

  const finalists = new THREE.Group();
  const list = SOCIAL_SITES.finalists;
  const shirts = people(list.length);
  const scribbles = keep(new THREE.InstancedMesh(scribbleGeo, tinted, Math.max(1, list.length)));
  scribbles.frustumCulled = false;
  list.forEach((f, i) => {
    matrix.makeRotationY(yawOf(f.face)).setPosition(f.x / M, 0, f.y / M);
    shirts.bodies.setMatrixAt(i, matrix);
    shirts.heads.setMatrixAt(i, matrix);
    scribbles.setMatrixAt(i, matrix);
    shirts.bodies.setColorAt(i, tint.set(SHIRT));
    scribbles.setColorAt(i, tint.set(INK[i % INK.length]));
  });
  shirts.bodies.count = shirts.heads.count = scribbles.count = list.length;
  finalists.add(shirts.bodies, shirts.heads, scribbles);
  finalists.visible = false;
  root.add(finalists);

  const ring = SOCIAL_SITES.gyration;
  const shrine = new THREE.Group();
  const circle = people(DRUMMERS + CIRCLE);
  let shrineLabel: THREE.Sprite | undefined;
  if (ring) {
    shrine.position.set(ring.x / M, 0, ring.y / M);
    const drums: THREE.BufferGeometry[] = [];
    for (let k = 0; k < DRUMMERS; k++) {
      const a = (k / DRUMMERS) * Math.PI * 2;
      drums.push(boxAt(0.42, 0.7, 0.42, Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, a));
    }
    shrine.add(new THREE.Mesh(keep(mergeParts(drums)), mat(DRUM.wood)));
    shrine.add(new THREE.Mesh(keep(boxAt(0.5, 0.45, 0.5, 0, 0, 0)), mat(DRUM.keg)));
    for (let i = 0; i < DRUMMERS + CIRCLE; i++) circle.bodies.setColorAt(i, tint.set(MEMBERS[i % MEMBERS.length]));
    shrine.add(circle.bodies, circle.heads);
    shrineLabel = label(TEXT.gyration, ring.x / M, ring.y / M);
  }
  shrine.visible = false;
  root.add(shrine);

  const forecourt = SOCIAL_SITES.forecourt;
  const games = new THREE.Group();
  let gamesLabel: THREE.Sprite | undefined;
  if (forecourt) {
    games.position.set(forecourt.x / M, 0, forecourt.y / M + CANOPY_SOUTH_M);
    const frame: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push(boxAt(0.08, 2.4, 0.08, sx * 2.6, 0, sz * 1.2));
    games.add(new THREE.Mesh(keep(mergeParts(frame)), mat(CANOPY.pole)));
    games.add(new THREE.Mesh(keep(boxAt(5.6, 0.1, 2.8, 0, 2.4, 0)), mat(CANOPY.cloth)));
    games.add(new THREE.Mesh(keep(boxAt(3.2, 0.8, 0.8, 0, 0, 0)), mat(CANOPY.table)));
    games.add(new THREE.Mesh(keep(mergeParts([boxAt(0.6, 0.4, 0.6, -0.9, 0.8, 0), boxAt(0.6, 0.4, 0.6, 0.9, 0.8, 0)])), mat(CANOPY.pot)));
    games.add(new THREE.Mesh(keep(mergeParts([boxAt(0.5, 0.05, 0.5, -0.9, 1.2, 0), boxAt(0.5, 0.05, 0.5, 0.9, 1.2, 0)])), mat(CANOPY.rice)));
    gamesLabel = label(TEXT.games, forecourt.x / M, forecourt.y / M + CANOPY_SOUTH_M);
  }
  games.visible = false;
  root.add(games);

  const within = (x: number, z: number, focus: THREE.Vector3, reach: number) => Math.hypot(x - focus.x, z - focus.z) < reach;

  function drum(radius: number, minutes: number) {
    const total = DRUMMERS + CIRCLE;
    for (let i = 0; i < total; i++) {
      const drummer = i < DRUMMERS;
      const a = drummer ? (i / DRUMMERS) * Math.PI * 2 : ((i - DRUMMERS + 0.5) / CIRCLE) * Math.PI * 2 + minutes * 0.2;
      const r = drummer ? 1.1 : radius * 0.62;
      const lift = Math.abs(Math.sin(minutes * BEAT + i)) * (drummer ? 0.04 : 0.12);
      matrix.makeRotationY(Math.atan2(-Math.cos(a), -Math.sin(a))).setPosition(Math.cos(a) * r, lift, Math.sin(a) * r);
      circle.bodies.setMatrixAt(i, matrix);
      circle.heads.setMatrixAt(i, matrix);
    }
    circle.bodies.instanceMatrix.needsUpdate = true;
    circle.heads.instanceMatrix.needsUpdate = true;
  }

  let live = { total: Number.NaN, signout: false, gyration: false, games: false };

  return {
    group: root,
    update(focus, t, minutes) {
      if (t.total !== live.total) live = { total: t.total, signout: liveEvent("signout", t) !== undefined, gyration: liveEvent("gyration", t) !== undefined, games: liveEvent("games", t) !== undefined };
      finalists.visible = list.length > 0 && live.signout;
      const gyrating = !!ring && live.gyration;
      shrine.visible = gyrating && !!ring && within(ring.x / M, ring.y / M, focus, CULL_M);
      if (shrineLabel) shrineLabel.visible = gyrating && !!ring && within(ring.x / M, ring.y / M, focus, LABEL_M);
      if (shrine.visible && ring) drum(ring.radius / M, minutes);
      const playing = !!forecourt && live.games;
      games.visible = playing && !!forecourt && within(forecourt.x / M, forecourt.y / M, focus, CULL_M);
      if (gamesLabel) gamesLabel.visible = playing && !!forecourt && within(forecourt.x / M, forecourt.y / M, focus, LABEL_M);
    },
    dispose() {
      for (const sprite of labels) disposeLabel(sprite);
      root.removeFromParent();
      disposables.forEach((item) => item.dispose());
    },
  };
}
