import * as THREE from "three";
import { DEBATE_SITE, ELECTION_TIMES, FORM_DESK, MINUTES_PER_DAY, POLL_UNITS, PX_PER_METER, RALLY_POINTS, activeRallies, formsOnSale, weekMinute, type GameTime, type PoliticsSite } from "@campuslife/shared";
import { disposeLabel, makeLabel } from "../labels";

type PropKind = "unit" | "desk" | "rally" | "debate";

interface Placed {
  kind: PropKind;
  index: number;
  group: THREE.Group;
  label: THREE.Sprite;
  x: number;
  z: number;
}

export interface PoliticsProps {
  group: THREE.Group;
  update(focus: THREE.Vector3, t: GameTime): void;
  dispose(): void;
}

const M = PX_PER_METER;
const CULL_M = 170;
const LABEL_M = 60;
const SETUP_MINUTES = 60;
const STEEL = 0x8a9096;
const WOOD = 0x9a7048;
const CLOTH = 0x1f7a4d;
const CANOPY = 0xf4f1e6;
const BOX = 0xdfe6e9;
const LIDS = [0x1f7a4d, 0xb5462f];
const ROPE = 0xd9a520;
const STAGE = 0x4a3b2c;
const BUS = 0xf2efe6;
const TYRE = 0x1b1b1d;
const SPEAKER = 0x202226;
const CAMP_COLORS = [0x1f7a4d, 0x1d4f91, 0xb5462f, 0x7341c9, 0xd9a520, 0x0f766e, 0xbe185d, 0x374151, 0xc2410c];
const SKIN = 0x7a4a2b;
const LABEL_STYLE = { screenHeight: 0.028, background: "rgba(31,122,77,0.92)", color: "#ffffff" };
const CROWD: readonly [number, number][] = [[-2.2, 3.2], [-1.2, 3.8], [-0.2, 3.3], [0.9, 3.9], [1.9, 3.2], [-0.8, 5], [0.6, 5.1], [2.4, 4.6]];

export function buildPoliticsProps(shadows: boolean): PoliticsProps {
  const root = new THREE.Group();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const tubeGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const ballGeo = new THREE.IcosahedronGeometry(0.5, 1);
  const coneGeo = new THREE.ConeGeometry(1, 1, 8, 1, true);
  const mats = new Map<number, THREE.MeshLambertMaterial>();
  const mat = (color: number) => {
    let m = mats.get(color);
    if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
    return m;
  };
  const add = (g: THREE.Object3D, geo: THREE.BufferGeometry, color: number, size: [number, number, number], at: [number, number, number], cast = false) => {
    const mesh = new THREE.Mesh(geo, mat(color));
    mesh.scale.set(...size);
    mesh.position.set(...at);
    mesh.castShadow = shadows && cast;
    g.add(mesh);
    return mesh;
  };
  const table = (g: THREE.Object3D, w: number, d: number, z = 0) => {
    add(g, boxGeo, CLOTH, [w, 0.5, d], [0, 0.55, z], true);
    add(g, boxGeo, WOOD, [w + 0.1, 0.06, d + 0.1], [0, 0.83, z]);
  };

  const draw: Record<PropKind, (g: THREE.Group, index: number) => void> = {
    unit(g) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, tubeGeo, STEEL, [0.08, 2.4, 0.08], [sx * 1.9, 1.2, sz * 1.3]);
      add(g, boxGeo, CANOPY, [4.2, 0.1, 3], [0, 2.45, 0], true);
      add(g, boxGeo, CLOTH, [4.2, 0.3, 0.05], [0, 2.3, 1.5]);
      table(g, 2.4, 0.8);
      LIDS.forEach((lid, k) => {
        const x = k === 0 ? -0.6 : 0.6;
        add(g, boxGeo, BOX, [0.45, 0.45, 0.45], [x, 1.09, 0], true);
        add(g, boxGeo, lid, [0.48, 0.06, 0.48], [x, 1.34, 0]);
      });
      for (let k = 0; k < 4; k++) {
        add(g, tubeGeo, STEEL, [0.07, 1, 0.07], [-1.4, 0.5, 2.2 + k * 1.3]);
        if (k < 3) add(g, boxGeo, ROPE, [0.04, 0.04, 1.3], [-1.4, 0.92, 2.85 + k * 1.3]);
      }
    },
    desk(g) {
      table(g, 2, 0.8);
      add(g, boxGeo, CANOPY, [0.5, 0.12, 0.36], [-0.4, 0.92, 0]);
      add(g, boxGeo, CANOPY, [0.5, 0.08, 0.36], [0.4, 0.9, 0]);
      add(g, tubeGeo, STEEL, [0.07, 2.6, 0.07], [0, 1.3, -0.6]);
      add(g, coneGeo, CLOTH, [1.7, 0.7, 1.7], [0, 2.75, -0.6], true);
    },
    rally(g, index) {
      const color = CAMP_COLORS[index % CAMP_COLORS.length];
      add(g, boxGeo, STAGE, [4.4, 0.5, 2.4], [0, 0.25, 0], true);
      add(g, boxGeo, color, [4.4, 2, 0.08], [0, 1.6, -1.15], true);
      for (const sx of [-1, 1]) add(g, boxGeo, SPEAKER, [0.6, 1, 0.6], [sx * 2.7, 0.5, 0.6], true);
      add(g, boxGeo, BUS, [2, 2, 5], [-5, 1.3, 0], true);
      add(g, boxGeo, color, [2.04, 0.4, 5.04], [-5, 1, 0]);
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) add(g, tubeGeo, TYRE, [0.7, 0.3, 0.7], [-5 + sx * 0.95, 0.35, sz * 1.6]).rotation.z = Math.PI / 2;
      add(g, boxGeo, SPEAKER, [0.8, 0.5, 0.8], [-5, 2.55, 1.4]);
      CROWD.forEach(([x, z], k) => {
        add(g, tubeGeo, k % 3 === 0 ? CANOPY : color, [0.42, 1.15, 0.42], [x, 0.58, z], true);
        add(g, ballGeo, SKIN, [0.3, 0.3, 0.3], [x, 1.34, z]);
      });
    },
    debate(g) {
      add(g, boxGeo, STAGE, [3.4, 0.4, 2], [0, 0.2, 0], true);
      add(g, boxGeo, CLOTH, [3.4, 1.8, 0.08], [0, 1.3, -0.95], true);
      add(g, boxGeo, WOOD, [0.6, 1.1, 0.5], [0, 0.95, 0.2], true);
      for (const sx of [-1, 1]) add(g, boxGeo, SPEAKER, [0.5, 0.9, 0.5], [sx * 2.1, 0.45, 0.4], true);
    },
  };
  const titles: Record<PropKind, (site: PoliticsSite) => string> = {
    unit: (site) => `Polling unit: ${site.name}`,
    desk: () => "SUIEC: nomination forms",
    rally: (site) => `Rally: ${site.name}`,
    debate: () => "Press Night and Debate",
  };

  const placed: Placed[] = [];
  const place = (kind: PropKind, site: PoliticsSite, index: number) => {
    const group = new THREE.Group();
    draw[kind](group, index);
    group.position.set(site.x / M, 0, site.y / M);
    group.rotation.y = Math.atan2(Math.cos(site.face), Math.sin(site.face)) + Math.PI;
    group.visible = false;
    const label = makeLabel(titles[kind](site), LABEL_STYLE);
    label.position.set(site.x / M, 3.2, site.y / M);
    label.visible = false;
    root.add(group, label);
    placed.push({ kind, index, group, label, x: site.x / M, z: site.y / M });
  };
  POLL_UNITS.forEach((site, i) => place("unit", site, i));
  place("desk", FORM_DESK, 0);
  RALLY_POINTS.forEach((site, i) => place("rally", site, i));
  place("debate", DEBATE_SITE, 0);

  return {
    group: root,
    update(focus, t) {
      const m = weekMinute(t);
      const rallies = new Set(activeRallies(t).map((r) => r.site));
      const on: Record<PropKind, (index: number) => boolean> = {
        unit: () => m >= ELECTION_TIMES.pollsOpen - SETUP_MINUTES && m < ELECTION_TIMES.results,
        desk: () => formsOnSale(t),
        rally: (index) => rallies.has(index),
        debate: () => m >= ELECTION_TIMES.debateStart - SETUP_MINUTES && m < ELECTION_TIMES.debateEnd && m < 4 * MINUTES_PER_DAY,
      };
      for (const p of placed) {
        const d = Math.hypot(p.x - focus.x, p.z - focus.z);
        const live = on[p.kind](p.index);
        p.group.visible = live && d < CULL_M;
        p.label.visible = live && d < LABEL_M;
      }
    },
    dispose() {
      for (const p of placed) disposeLabel(p.label);
      root.removeFromParent();
      for (const g of [boxGeo, tubeGeo, ballGeo, coneGeo]) g.dispose();
      for (const m of mats.values()) m.dispose();
    },
  };
}
