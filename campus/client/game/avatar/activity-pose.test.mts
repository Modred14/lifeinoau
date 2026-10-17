import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import type { GLTFLoader as Loader } from "three/addons/loaders/GLTFLoader.js";
import { DEFAULT_LOOK, applyStudentOutfit, encodeLook, type BodyType } from "@campuslife/shared/avatar";
import { SEATS, type SeatStyle } from "@campuslife/shared/interiors";
import { Character } from "../characters.ts";
import type { PoseDetail } from "./pose-detail.ts";

const require = createRequire(import.meta.url);
const { GLTFLoader } = require("three/addons/loaders/GLTFLoader.js") as { GLTFLoader: typeof Loader };
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
GLTFLoader.prototype.loadAsync = async function (url: string) {
  const bytes = await readFile(path.join(publicDir, new URL(url, "http://localhost").pathname.replace(/^\/campus\//, "/")));
  return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
};

const at = (c: Character, name: string) => c.root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
async function student(body: BodyType, outfit: string) {
  const c = new Character(encodeLook(applyStudentOutfit({ ...DEFAULT_LOOK, body }, outfit)));
  await c.whenReady();
  c.update(0.3, 0);
  return c;
}
const settle = (c: Character, seconds = 1) => { for (let t = 0; t < seconds; t += 0.05) c.update(0.05, 0); };

test("a seated student rests on the seat with level thighs and feet on the floor", async () => {
  for (const body of ["m", "f"] as const) for (const outfit of ["lecture", "uniform", "native", "lab"]) for (const style of Object.keys(SEATS) as SeatStyle[]) {
    const c = await student(body, outfit);
    try {
      const seat = SEATS[style];
      c.setPose("sit", { variant: "listen", seat });
      settle(c);
      c.root.updateMatrixWorld(true);
      for (const side of ["L", "R"]) {
        const hip = at(c, `UpperLeg${side}`), knee = at(c, `LowerLeg${side}`), foot = at(c, `Foot${side}`);
        const where = `${body} ${outfit} ${style} ${side}`;
        assert.ok(hip.y > seat.h + 0.05 && hip.y < seat.h + 0.13, `${where}: hip ${hip.y.toFixed(3)} is not on the ${seat.h} seat`);
        assert.ok(Math.abs(hip.z - seat.hip) < 0.06, `${where}: hip is ${hip.z.toFixed(3)} from the seat centre`);
        assert.ok(Math.abs(knee.y - hip.y) < 0.09 && knee.z - hip.z > 0.33, `${where}: thigh is not level and forward`);
        assert.ok(foot.y > -0.01 && foot.y < 0.07, `${where}: foot bone at ${foot.y.toFixed(3)} is off the floor`);
        assert.ok(Math.abs(foot.z - knee.z) < 0.06 && knee.y - foot.y > 0.35, `${where}: calf is not upright`);
      }
      const head = at(c, "Head"), hips = at(c, "Hips");
      assert.ok(head.y - hips.y > 0.5 && Math.abs(head.z - hips.z) < 0.14, `${body} ${outfit} ${style}: back is not upright`);
    } finally { c.dispose(); }
  }
});

test("writing and eating hands reach the surface and the mouth without passing through it", async () => {
  for (const body of ["m", "f"] as const) {
    const c = await student(body, "hostel");
    try {
      const surface = { h: 0.74, near: 0.28 };
      c.setPose("sit", { variant: "write", seat: SEATS.fixed, surface, focused: true });
      settle(c);
      for (const side of ["L", "R"]) {
        const wrist = at(c, `Wrist${side}`);
        assert.ok(wrist.y > surface.h && wrist.y < surface.h + 0.12, `${body} ${side} writing wrist at ${wrist.y.toFixed(3)}`);
        assert.ok(wrist.z > surface.near - 0.08 && wrist.z < surface.near + 0.3, `${body} ${side} writing wrist is off the ledge`);
        const elbow = at(c, `LowerArm${side}`);
        assert.ok(elbow.y > surface.h - 0.02 || elbow.z < surface.near, `${body} ${side} elbow is inside the ledge`);
      }
      const table = { h: 0.72, near: 0.23 };
      const detail: PoseDetail = { variant: "eat", seat: SEATS.plastic, surface: table, dish: "Jollof rice & chicken" };
      c.setPose("sit", detail);
      let low = Infinity, closest = Infinity;
      for (let t = 0; t < 6; t += 0.05) {
        c.update(0.05, 0);
        const wrist = at(c, "WristR"), head = at(c, "Head");
        low = Math.min(low, wrist.y);
        closest = Math.min(closest, wrist.distanceTo(head.add(new THREE.Vector3(0, 0.03, 0.1))));
      }
      assert.ok(low > table.h && low < table.h + 0.16, `${body} eating hand lowest point ${low.toFixed(3)}`);
      assert.ok(closest < 0.24, `${body} eating hand stays ${closest.toFixed(3)} from the mouth`);
      const props = c.root.getObjectByName("pose-props");
      assert.ok(props && props.children.length >= 2, "no plate or drink on the table");
      c.setPose("eat", { variant: "eat", dish: "Shawarma" });
      settle(c, 3);
      assert.equal(c.root.children.filter((child) => child.name === "pose-props").length, 1);
      assert.ok(at(c, "FootL").y < 0.08 && at(c, "UpperLegL").y > 0.8, `${body} standing eater is not standing`);
    } finally { c.dispose(); }
  }
});

test("leaving an activity restores the animated arms, spine and feet", async () => {
  const pose = await student("m", "lecture"), control = await student("m", "lecture");
  try {
    pose.setPose("sit", { variant: "eat", seat: SEATS.bench, surface: { h: 0.75, near: 0.225 }, dish: "Amala & ewedu" });
    settle(pose, 2); settle(control, 2);
    pose.setPose("stand");
    assert.equal(pose.root.getObjectByName("pose-props"), undefined);
    for (const speed of [0, 2, 5]) {
      for (let k = 0; k < 8; k++) { pose.update(0.1, speed); control.update(0.1, speed); }
    }
    for (const name of ["UpperArmL", "UpperArmR", "LowerArmL", "LowerArmR", "WristL", "WristR", "Abdomen", "Neck", "FootL", "FootR"]) {
      const a = pose.root.getObjectByName(name)!.quaternion.clone().normalize(), b = control.root.getObjectByName(name)!.quaternion.clone().normalize();
      assert.ok(a.angleTo(b) < 0.02, `${name} did not recover (${a.angleTo(b).toFixed(3)} rad)`);
    }
  } finally { pose.dispose(); control.dispose(); }
});

test("characters follow the floor height and keep a caller's own offset", async () => {
  const c = await student("f", "sports");
  const holder = new THREE.Group();
  try {
    holder.add(c.root);
    c.root.position.y = 0.2;
    Character.groundAt = () => 0.96;
    settle(c, 2);
    assert.ok(Math.abs(c.root.position.y - 1.16) < 0.005);
    holder.position.y = 0.96;
    settle(c, 2);
    assert.ok(Math.abs(c.root.position.y - 0.2) < 0.005);
    Character.groundAt = undefined;
    holder.position.y = 0;
    settle(c, 2);
    assert.ok(Math.abs(c.root.position.y - 0.2) < 0.005);
  } finally { Character.groundAt = undefined; c.dispose(); }
});
