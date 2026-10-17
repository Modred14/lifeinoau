import * as THREE from "three";
import { CONGRESS_SITE, CONGRESS_VENUE, PLACARDS, PX_PER_METER, congressStand, marchAt, marchPlan, type UnionState, type CongressSitting, type GameTime } from "@campuslife/shared";
import { disposeLabel, makeLabel } from "../labels";

const M = PX_PER_METER;
const CULL_M = 190;
const MARCHERS = 36;
const PLACARD_COUNT = 5;
const HOUSE = 28;
const CHASE = 0.08;
const COLUMN = { across: 4, gapAcross: 1.1, gapAlong: 1.3, lead: 2 };
const BODY = { radius: 0.21, height: 1.15, head: 0.3 };
const SHIRTS = [0xf4f1e6, 0x1f7a4d, 0x1d4f91, 0xb5462f, 0xd9a520, 0x374151];
const SKIN = 0x7a4a2b;
const PLACARD_STYLE = { screenHeight: 0.024, background: "rgba(244,241,230,0.95)", color: "#16211b" };
const SIDE_STYLE = { aye: { screenHeight: 0.03, background: "rgba(31,122,77,0.92)", color: "#ffffff" }, nay: { screenHeight: 0.03, background: "rgba(181,70,47,0.92)", color: "#ffffff" } };
const VENUE_STYLE = { screenHeight: 0.028, background: "rgba(22,33,27,0.9)", color: "#ffffff" };
const HOUSE_RING = { near: 3.5, step: 1.2, perRow: 7, spread: 1.1 };

export interface UnionCrowds {
  group: THREE.Group;
  update(focus: THREE.Vector3, t: GameTime, states: readonly UnionState[], sittings: readonly CongressSitting[]): void;
  dispose(): void;
}

export function buildUnionCrowds(): UnionCrowds {
  const root = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(BODY.radius, BODY.radius, BODY.height, 6);
  const headGeo = new THREE.IcosahedronGeometry(BODY.head / 2, 0);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const headMat = new THREE.MeshLambertMaterial({ color: SKIN });
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  const crowd = (count: number, layout: (i: number) => [number, number]) => {
    const group = new THREE.Group();
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    const heads = new THREE.InstancedMesh(headGeo, headMat, count);
    for (let i = 0; i < count; i++) {
      const [x, z] = layout(i);
      dummy.position.set(x, BODY.height / 2, z);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, tint.setHex(SHIRTS[i % SHIRTS.length]));
      dummy.position.set(x, BODY.height + BODY.head / 2, z);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
    }
    bodies.frustumCulled = heads.frustumCulled = false;
    group.add(bodies, heads);
    group.visible = false;
    root.add(group);
    return group;
  };

  const march = crowd(MARCHERS, (i) => [-(COLUMN.lead + Math.floor(i / COLUMN.across) * COLUMN.gapAlong), ((i % COLUMN.across) - (COLUMN.across - 1) / 2) * COLUMN.gapAcross]);
  const placards = Array.from({ length: PLACARD_COUNT }, (_v, k) => {
    const label = makeLabel(PLACARDS[k % PLACARDS.length], PLACARD_STYLE);
    label.position.set(-(COLUMN.lead + k * 2 * COLUMN.gapAlong), 2.3 + (k % 2) * 0.35, (k % 2 ? 1 : -1) * COLUMN.gapAcross);
    march.add(label);
    return label;
  });

  const site = { x: CONGRESS_SITE.x / M, z: CONGRESS_SITE.y / M };
  const house = new THREE.Group();
  house.position.set(site.x, 0, site.z);
  house.visible = false;
  root.add(house);
  const sides = (["aye", "nay"] as const).map((side) => {
    const stand = congressStand(side);
    const cx = stand.x / M - site.x;
    const cz = stand.y / M - site.z;
    const away = Math.hypot(cx, cz) || 1;
    const group = crowd(HOUSE, (i) => {
      const row = Math.floor(i / HOUSE_RING.perRow);
      const col = (i % HOUSE_RING.perRow) - (HOUSE_RING.perRow - 1) / 2;
      const out = HOUSE_RING.near + row * HOUSE_RING.step;
      return [(cx / away) * out - (cz / away) * col * HOUSE_RING.spread, (cz / away) * out + (cx / away) * col * HOUSE_RING.spread];
    });
    root.remove(group);
    house.add(group);
    group.visible = true;
    const label = makeLabel(side === "aye" ? "AYE: stand this side" : "NAY: stand this side", SIDE_STYLE[side]);
    label.position.set(cx, 2.8, cz);
    house.add(label);
    return label;
  });
  const venue = makeLabel(`Congress: ${CONGRESS_VENUE}`, VENUE_STYLE);
  venue.position.set(0, 3.8, 0);
  house.add(venue);

  return {
    group: root,
    update(focus, t, states, sittings) {
      house.visible = sittings.length > 0 && Math.hypot(site.x - focus.x, site.z - focus.z) < CULL_M;
      const protest = states.find((s) => s.kind === "protest");
      const spot = protest ? marchAt(marchPlan(protest), t.total) : undefined;
      const live = !!spot && spot.phase !== "before" && spot.phase !== "done";
      if (!live || !spot || !protest) {
        march.visible = false;
        return;
      }
      const x = spot.x / M;
      const z = spot.y / M;
      const jump = !march.visible || Math.hypot(march.position.x - x, march.position.z - z) > CULL_M;
      if (jump) march.position.set(x, 0, z);
      else march.position.lerp(dummy.position.set(x, 0, z), CHASE);
      march.rotation.y = -spot.angle;
      march.visible = Math.hypot(x - focus.x, z - focus.z) < CULL_M;
    },
    dispose() {
      for (const label of [...placards, ...sides, venue]) disposeLabel(label);
      root.removeFromParent();
      bodyGeo.dispose();
      headGeo.dispose();
      bodyMat.dispose();
      headMat.dispose();
    },
  };
}
