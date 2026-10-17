/**
 * Renders one building interior from its shared template (interiors.ts):
 * tiled floor, walls (the south wall is cut low so you can see in), and
 * furniture. Static furniture is merged per material, so even a lecture
 * theatre with 60 seats is only a handful of draw calls.
 */
import * as THREE from "three";
import { PLACES } from "@campuslife/shared/map";
import type { Interior } from "@campuslife/shared/interiors";
import { toWorld } from "./coords";
import { Kit, type KitStats } from "./interior/kit";
import { buildRoom, wallHeight } from "./interior/room";
import { entryFloor } from "./interior/shell";
import { disposeLabel, makeLabel } from "./labels";
import { addCutout } from "./world";

export interface BuiltInterior {
  group: THREE.Group;
  stats: KitStats;
  dispose(): void;
}

export function buildInterior(it: Interior, shadows: boolean): BuiltInterior {
  const t = it.template;
  const group = new THREE.Group();
  group.position.set(toWorld(it.ox), 0, toWorld(it.oy));
  const kit = new Kit();
  const labels: THREE.Sprite[] = [];
  const label = (sprite: THREE.Sprite, x: number, y: number, z: number) => {
    sprite.position.set(x, y, z);
    group.add(sprite);
    labels.push(sprite);
  };

  const floorTex = kit.track(tileTexture(t.floor));
  floorTex.repeat.set(t.w / 1.2, t.d / 1.2);
  const floor = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(t.w, t.d)), kit.track(new THREE.MeshLambertMaterial({ map: floorTex })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(t.w / 2, 0.01, t.d / 2);
  floor.receiveShadow = shadows;
  group.add(floor);
  // Dark ground around the room so it doesn't float in the void.
  const yard = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(t.w + 40, t.d + 40)), kit.track(new THREE.MeshBasicMaterial({ color: 0x1a1714 })));
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(t.w / 2, -0.01, t.d / 2);
  group.add(yard);

  buildRoom(kit, t, () => {
    const wallMat = new THREE.MeshLambertMaterial({ color: t.wall });
    addCutout(wallMat);
    return wallMat;
  });
  const stats = kit.build(group, shadows);
  stats.drawCalls += 2;
  stats.triangles += 4;

  label(makeLabel("EXIT", { screenHeight: 0.02, background: "rgba(22,128,61,0.95)", bold: true }), t.w / 2, entryFloor(t) + 2.3, t.d);
  // Building name on the back wall.
  label(makeLabel(`${PLACES[it.place].name} · ${t.title}`, { screenHeight: 0.026 }), t.w / 2, wallHeight(t) + 0.6, 0);
  for (const p of t.props) {
    if (p.type !== "counter" || !p.label) continue;
    const spot = t.spots.find((s) => s.label === p.label);
    const text = spot?.price ? `${p.label} · ₦${spot.price.toLocaleString("en-NG")}` : p.label;
    label(makeLabel(text, { screenHeight: 0.02, background: "rgba(154,52,18,0.92)" }), p.x, 2.5, p.y - 0.6);
  }

  return {
    group,
    stats,
    dispose() {
      group.removeFromParent();
      labels.forEach(disposeLabel);
      kit.dispose();
    },
  };
}

/** Ceramic floor tiles tinted to the room's colour. */
function tileTexture(color: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const base = new THREE.Color(color);
  g.fillStyle = `#${base.clone().multiplyScalar(0.8).getHexString()}`;
  g.fillRect(0, 0, 64, 64);
  for (const [x, y, k] of [[0, 0, 1], [32, 0, 0.94], [0, 32, 0.97], [32, 32, 1.03]] as const) {
    g.fillStyle = `#${base.clone().multiplyScalar(k).getHexString()}`;
    g.fillRect(x + 1, y + 1, 30, 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
