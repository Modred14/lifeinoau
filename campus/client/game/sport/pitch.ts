import * as THREE from "three";
import {
  GROUND_IDS,
  MATCH_GATE_OPENS,
  PITCHES,
  PX_PER_METER,
  SOCIAL_SITES,
  SPOTS,
  currentPitchMatch,
  matchState,
  type GameTime,
  type GroundId,
  type Pitch,
  type PitchMatch,
} from "@campuslife/shared";
import { boxAt, mergeParts } from "../interior/kit";

export interface PitchLayer {
  group: THREE.Group;
  update(focus: THREE.Vector3, t: GameTime, minutes: number): void;
  dispose(): void;
}

const M = PX_PER_METER;
const CULL_M = 240;
const LINE = { width: 0.14, height: 0.03, color: 0xf5f5f0 };
const GOAL = { width: 7.3, height: 2.4, post: 0.12 };
const BOX = { depth: 16.5, width: 40 };
const CIRCLE = { radius: 9.15, segments: 24 };
const BENCH = { length: 4.4, depth: 0.32, height: 0.45, color: 0x8a6a45 };
const SIDE = 11;
const REFEREE = 0x111111;
const SKIN = 0x6f4630;
const BALL = { radius: 0.22, color: 0xffffff };
const CROWD = { count: 28, spread: 0.8, back: 3.2, rows: 2, colors: [0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825, 0xeeeeee, 0x6a1b9a] };
const FORMATION: readonly [number, number][] = [[-0.92, 0], [-0.62, -0.6], [-0.66, -0.2], [-0.66, 0.2], [-0.62, 0.6], [-0.32, -0.62], [-0.36, -0.2], [-0.36, 0.2], [-0.32, 0.62], [-0.08, -0.25], [-0.08, 0.25]];
const PLAY = { pull: 0.32, sway: 1.4, ballX: 0.42, ballZ: 0.4, speedX: 0.9, speedZ: 1.37, bob: 0.06 };

interface Ground {
  id: GroundId;
  pitch: Pitch;
  root: THREE.Group;
  live: THREE.Group;
  bodies: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  crowdBodies: THREE.InstancedMesh;
  crowdHeads: THREE.InstancedMesh;
  ball: THREE.Mesh;
  key: string;
  phase: number;
  minute: number;
  match?: PitchMatch;
  on: boolean;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function markings(pitch: Pitch): THREE.BufferGeometry {
  const length = pitch.length / M;
  const width = pitch.width / M;
  const boxWidth = Math.min(BOX.width, width * 0.7);
  const parts: THREE.BufferGeometry[] = [];
  const line = (w: number, d: number, x: number, z: number) => parts.push(boxAt(w, LINE.height, d, x, 0.02, z));
  for (const side of [-1, 1]) {
    line(length, LINE.width, 0, (side * width) / 2);
    line(LINE.width, width, (side * length) / 2, 0);
    line(LINE.width, boxWidth, side * (length / 2 - BOX.depth), 0);
    for (const edge of [-1, 1]) line(BOX.depth, LINE.width, side * (length / 2 - BOX.depth / 2), (edge * boxWidth) / 2);
    for (const post of [-1, 1]) parts.push(boxAt(GOAL.post, GOAL.height, GOAL.post, (side * length) / 2, 0, (post * GOAL.width) / 2));
    parts.push(boxAt(GOAL.post, GOAL.post, GOAL.width, (side * length) / 2, GOAL.height, 0));
  }
  line(LINE.width, width, 0, 0);
  for (let k = 0; k < CIRCLE.segments; k++) {
    const a = (k / CIRCLE.segments) * Math.PI * 2;
    parts.push(boxAt((CIRCLE.radius * Math.PI * 2) / CIRCLE.segments, LINE.height, LINE.width, Math.cos(a) * CIRCLE.radius, 0.02, Math.sin(a) * CIRCLE.radius, -a + Math.PI / 2));
  }
  return mergeParts(parts);
}

function local(pitch: Pitch, x: number, y: number): [number, number] {
  const ux = Math.cos(pitch.angle);
  const uy = Math.sin(pitch.angle);
  const dx = (x - pitch.cx) / M;
  const dy = (y - pitch.cy) / M;
  return [dx * ux + dy * uy, -dx * uy + dy * ux];
}

function benches(pitch: Pitch, seats: readonly number[]): THREE.BufferGeometry | undefined {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 5 < seats.length; i += 6) {
    const group = seats.slice(i, i + 6).map((s) => local(pitch, SPOTS[s].x, SPOTS[s].y));
    const x = group.reduce((sum, p) => sum + p[0], 0) / group.length;
    const z = group.reduce((sum, p) => sum + p[1], 0) / group.length;
    parts.push(boxAt(BENCH.length, 0.06, BENCH.depth, x, BENCH.height - 0.06, z));
    for (const leg of [-1, 1]) parts.push(boxAt(0.08, BENCH.height - 0.06, BENCH.depth, x + leg * (BENCH.length / 2 - 0.3), 0, z));
  }
  return parts.length ? mergeParts(parts) : undefined;
}

export function buildPitches(): PitchLayer {
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const white = keep(new THREE.MeshBasicMaterial({ color: LINE.color }));
  const wood = keep(new THREE.MeshLambertMaterial({ color: BENCH.color }));
  const cloth = keep(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const skin = keep(new THREE.MeshLambertMaterial({ color: SKIN }));
  const ballMat = keep(new THREE.MeshLambertMaterial({ color: BALL.color }));
  const bodyGeo = keep(mergeParts([boxAt(0.38, 0.6, 0.22, 0, 0.8, 0), boxAt(0.32, 0.8, 0.18, 0, 0, 0)]));
  const headGeo = keep(boxAt(0.2, 0.22, 0.2, 0, 1.42, 0));
  const ballGeo = keep(new THREE.IcosahedronGeometry(BALL.radius, 1));
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  const grounds: Ground[] = [];

  for (const id of GROUND_IDS) {
    const pitch = PITCHES[id];
    if (!pitch) continue;
    const group = new THREE.Group();
    group.position.set(pitch.cx / M, 0, pitch.cy / M);
    group.rotation.y = -pitch.angle;
    group.add(new THREE.Mesh(keep(markings(pitch)), white));
    const seats = SOCIAL_SITES.touchline[id];
    const benchGeo = benches(pitch, seats);
    if (benchGeo) group.add(new THREE.Mesh(keep(benchGeo), wood));
    const live = new THREE.Group();
    const players = SIDE * 2 + 1;
    const bodies = new THREE.InstancedMesh(bodyGeo, cloth, players);
    const heads = new THREE.InstancedMesh(headGeo, skin, players);
    const crowdBodies = new THREE.InstancedMesh(bodyGeo, cloth, CROWD.count);
    const crowdHeads = new THREE.InstancedMesh(headGeo, skin, CROWD.count);
    const benchSide = seats.length ? Math.sign(local(pitch, SPOTS[seats[0]].x, SPOTS[seats[0]].y)[1]) || 1 : 1;
    const width = pitch.width / M;
    const length = pitch.length / M;
    for (let i = 0; i < CROWD.count; i++) {
      const row = i % CROWD.rows;
      const x = ((Math.floor(i / CROWD.rows) + 0.5) / (CROWD.count / CROWD.rows) - 0.5) * length * CROWD.spread + (hash(`${id}c${i}`) - 0.5);
      const z = -benchSide * (width / 2 + CROWD.back + row * 0.9);
      matrix.makeRotationY(benchSide > 0 ? 0 : Math.PI).setPosition(x, 0, z);
      crowdBodies.setMatrixAt(i, matrix);
      crowdHeads.setMatrixAt(i, matrix);
      crowdBodies.setColorAt(i, tint.set(CROWD.colors[Math.floor(hash(`${id}k${i}`) * CROWD.colors.length)]));
    }
    for (const mesh of [bodies, heads, crowdBodies, crowdHeads]) {
      mesh.frustumCulled = false;
      keep(mesh);
      live.add(mesh);
    }
    const ball = new THREE.Mesh(ballGeo, ballMat);
    live.add(ball);
    live.visible = false;
    group.add(live);
    root.add(group);
    grounds.push({ id, pitch, root: group, live, bodies, heads, crowdBodies, crowdHeads, ball, key: "", phase: 0, minute: Number.NaN, on: false });
  }

  function kit(g: Ground, match: PitchMatch) {
    g.key = match.key;
    g.phase = hash(match.key) * Math.PI * 2;
    for (let i = 0; i < SIDE * 2; i++) g.bodies.setColorAt(i, tint.set(i < SIDE ? match.home.color : match.away.color));
    g.bodies.setColorAt(SIDE * 2, tint.set(REFEREE));
    if (g.bodies.instanceColor) g.bodies.instanceColor.needsUpdate = true;
  }

  function play(g: Ground, match: PitchMatch, t: GameTime, minutes: number) {
    const state = matchState(match, t.total);
    const moving = state.phase === "first" || state.phase === "second";
    const length = g.pitch.length / M;
    const width = g.pitch.width / M;
    const clock = moving ? minutes : 0;
    const bx = moving ? Math.sin(clock * PLAY.speedX + g.phase) * PLAY.ballX * length : 0;
    const bz = moving ? Math.sin(clock * PLAY.speedZ + g.phase * 2) * PLAY.ballZ * width : 0;
    g.ball.position.set(bx, BALL.radius, bz);
    for (let i = 0; i <= SIDE * 2; i++) {
      const referee = i === SIDE * 2;
      const side = i < SIDE ? 1 : -1;
      const spot = referee ? [0.05, 0.1] : FORMATION[i % SIDE];
      const hx = spot[0] * side * (length / 2);
      const hz = spot[1] * side * (width / 2);
      const keeper = !referee && i % SIDE === 0;
      const pull = keeper ? 0.04 : referee ? 0.7 : PLAY.pull;
      const sway = moving ? Math.sin(clock * 2.3 + i * 1.7 + g.phase) * PLAY.sway : 0;
      const x = hx + (bx - hx) * (moving ? pull : 0) + sway;
      const z = hz + (bz - hz) * (moving ? pull : 0) + sway * 0.6;
      const lift = moving ? Math.abs(Math.sin(clock * 9 + i)) * PLAY.bob : 0;
      matrix.makeRotationY(Math.atan2(bx - x, bz - z)).setPosition(x, lift, z);
      g.bodies.setMatrixAt(i, matrix);
      g.heads.setMatrixAt(i, matrix);
    }
    g.bodies.instanceMatrix.needsUpdate = true;
    g.heads.instanceMatrix.needsUpdate = true;
  }

  return {
    group: root,
    update(focus, t, minutes) {
      for (const g of grounds) {
        const near = Math.hypot(g.root.position.x - focus.x, g.root.position.z - focus.z) < CULL_M;
        g.root.visible = near;
        if (!near) continue;
        if (g.minute !== t.total) {
          g.minute = t.total;
          g.match = currentPitchMatch(g.id, t);
          g.on = !!g.match && t.total >= g.match.startTotal - MATCH_GATE_OPENS / 2 && matchState(g.match, t.total).phase !== "full";
        }
        const match = g.match;
        const on = g.on;
        g.live.visible = on;
        if (!match || !on) continue;
        if (g.key !== match.key) kit(g, match);
        play(g, match, t, minutes);
      }
    },
    dispose() {
      root.removeFromParent();
      disposables.forEach((item) => item.dispose());
    },
  };
}
