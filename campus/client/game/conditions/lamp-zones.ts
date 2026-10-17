import * as THREE from "three";
import { POWER_ZONES, PX_PER_METER, powerZoneAt, zoneHasLight, type GameTime } from "@campuslife/shared";

export interface LampPower {
  apply(t: GameTime, glows: readonly THREE.InstancedMesh[]): void;
  dark(index: number): boolean;
}

const ON = new THREE.Color(0xffffff);
const OFF = new THREE.Color(0x000000);

export function lampPower(spots: readonly { x: number; z: number }[]): LampPower {
  const zones = spots.map((s) => powerZoneAt(s.x * PX_PER_METER, s.z * PX_PER_METER).index);
  const lit: boolean[] = POWER_ZONES.map(() => true);
  let stamp = -1;
  let mask = "";
  return {
    apply(t, glows) {
      if (t.total === stamp) return;
      stamp = t.total;
      for (const zone of POWER_ZONES) lit[zone.index] = zoneHasLight(zone.index, t.total);
      const next = lit.map((on) => (on ? "1" : "0")).join("");
      if (next === mask) return;
      mask = next;
      for (const mesh of glows) {
        for (let i = 0; i < zones.length; i++) mesh.setColorAt(i, lit[zones[i]] ? ON : OFF);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
    dark: (index) => !lit[zones[index]],
  };
}
