import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as THREE from "three";
import type { Bone, MeshStandardMaterial, SkinnedMesh } from "three";
import type { GLTFLoader as Loader } from "three/addons/loaders/GLTFLoader.js";
import { DEFAULT_LOOK, HAIR_COLORS, OUTFITS, SKIN_TONES, SLOTS, decodeLook, encodeLook } from "@campuslife/shared/avatar";
import { Character } from "../game/characters.ts";
import { StudentFace } from "../game/student-face.ts";
import { studioFraming } from "../game/studio-framing.ts";
import { CHARACTER_ASSET_VERSIONS } from "../game/character-assets.ts";
import { BOOT_SHAFTS } from "../game/footwear-shapes.ts";
import { FOOTWEAR_STYLES } from "./student-footwear.mts";
import { createStudentHair } from "./student-hair.mts";

const require = createRequire(import.meta.url);
const { GLTFLoader } = require("three/addons/loaders/GLTFLoader.js") as { GLTFLoader: typeof Loader };

async function loaded(character: Character, previous?: object) {
  const deadline = Date.now() + 5000;
  while (!character.ready || character.root.children[0] === previous) {
    if (Date.now() > deadline) throw new Error("Character did not load");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function rotations(character: Character) {
  const result = new Map<string, number[]>();
  character.root.traverse((node) => {
    if ((node as Bone).isBone) result.set(node.name, node.quaternion.toArray());
  });
  return result;
}

test("game characters load the rebuilt assets, share their rig and recover after a greeting", async (t) => {
  const requested = new Set<string>();
  let failNextAsset = true;
  let malformedAsset: string | undefined;
  t.mock.method(GLTFLoader.prototype, "loadAsync", async function (this: Loader, url: string) {
    requested.add(url);
    if (failNextAsset) {
      failNextAsset = false;
      throw new Error("Temporary model download failure");
    }
    const pathname = new URL(url, "http://localhost").pathname.replace(/^\/campus\//, "/");
    const bytes = await readFile(new URL(`../public${pathname}`, import.meta.url));
    const gltf = await this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    return pathname.endsWith(malformedAsset ?? "\u0000") ? { ...gltf, scene: new THREE.Group() } : gltf;
  });

  await t.test("a failed download can retry the same look and a closed preview stays disposed", async (t) => {
    t.mock.method(console, "warn", () => {});
    const look = encodeLook(DEFAULT_LOOK);
    const character = new Character(look);
    await assert.rejects(character.whenReady(), /Temporary model download failure/);
    assert.equal(character.status, "error");
    character.setLook(look);
    await character.whenReady();
    assert.equal(character.status, "ready");
    character.dispose();
    const closed = new Character(look);
    closed.dispose();
    await assert.rejects(closed.whenReady(), /unavailable/);
    assert.equal(closed.root.children.length, 0);
  });

  await t.test("rapid wardrobe changes keep only the latest character and a closed preview stays closed", async () => {
    const final = encodeLook({ ...DEFAULT_LOOK, body: "f", head: "braids", top: "nursing", bottom: "dress", shoes: "clogs", hair: 2 });
    const character = new Character(encodeLook(DEFAULT_LOOK));
    character.setLook(encodeLook({ ...DEFAULT_LOOK, head: "afro", top: "lab" }));
    character.setLook(final);
    await character.whenReady();
    assert.equal(character.root.children.length, 1);
    assert.deepEqual(character.look, decodeLook(final));
    character.dispose();
    character.setLook(encodeLook(DEFAULT_LOOK));
    await assert.rejects(character.whenReady(), /unavailable/);
    assert.equal(character.root.children.length, 0);
  });

  await t.test("clothing changes release character materials and skeletons without disposing another student", async () => {
    const first = encodeLook(DEFAULT_LOOK), next = encodeLook({ ...DEFAULT_LOOK, top: "formal", bottom: "native", shoes: "sandals" });
    const character = new Character(first), control = new Character(first);
    await Promise.all([character.whenReady(), control.whenReady()]);
    const materials = new Set<THREE.Material>(), skeletons = new Set<THREE.Skeleton>(), geometry = new Set<THREE.BufferGeometry>();
    character.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => materials.add(material));
      geometry.add(mesh.geometry);
      if ((mesh as SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as SkinnedMesh).skeleton);
    });
    let releasedMaterials = 0, releasedSkeletons = 0, releasedSharedGeometry = 0, releasedControlMaterials = 0;
    materials.forEach((material) => material.addEventListener("dispose", () => releasedMaterials++));
    geometry.forEach((item) => item.addEventListener("dispose", () => releasedSharedGeometry++));
    for (const skeleton of skeletons) {
      const original = skeleton.dispose;
      t.mock.method(skeleton, "dispose", function (this: THREE.Skeleton) { releasedSkeletons++; original.call(this); });
    }
    control.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => material.addEventListener("dispose", () => releasedControlMaterials++));
    });
    try {
      character.setLook(next); await character.whenReady();
      assert.equal(releasedMaterials, materials.size);
      assert.equal(releasedSkeletons, skeletons.size);
      assert.equal(releasedSharedGeometry, 0); assert.equal(releasedControlMaterials, 0);
      assert.equal(control.ready, true);
    } finally { character.dispose(); control.dispose(); }
  });

  await t.test("a malformed character source reports an error and can load a repaired source", async (t) => {
    t.mock.method(console, "warn", () => {});
    const look = encodeLook({ ...DEFAULT_LOOK, head: "buzz" });
    malformedAsset = "m-buzz.glb";
    const character = new Character(look);
    try {
      await assert.rejects(character.whenReady(), /skeleton|Head|head|slot|bone/i);
      assert.equal(character.status, "error");
      assert.equal(character.root.children.length, 0);
      malformedAsset = undefined;
      character.setLook(look); await character.whenReady();
      assert.equal(character.status, "ready");
      assert.equal(character.root.children.length, 1);
    } finally { malformedAsset = undefined; character.dispose(); }
  });

  await t.test("closed coats cover mixed bottoms without mutating cached clothing and release fitted geometry", async () => {
    for (const body of ["m", "f"] as const) {
      const look = { ...DEFAULT_LOOK, body, head: "afro", top: "nursing", bottom: "nursing", shoes: "loafers" };
      const control = new Character(encodeLook(look));
      await control.whenReady();
      const bottoms = (character: Character) => {
        const result: SkinnedMesh[] = [];
        character.root.traverse((node) => {
          const mesh = node as SkinnedMesh;
          if (mesh.isSkinnedMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((material) => material.name.startsWith("bottom:"))) result.push(mesh);
        });
        return result;
      };
      const originals = bottoms(control).map((mesh) => mesh.geometry);
      const before = originals.map((geometry) => Array.from(geometry.getAttribute("position").array));
      let sharedDisposals = 0;
      originals.forEach((geometry) => geometry.addEventListener("dispose", () => sharedDisposals++));
      try {
        for (const top of ["medical", "lab", "native"]) {
          const character = new Character(encodeLook({ ...look, top }));
          try {
            await character.whenReady();
            let hem = Infinity;
            character.root.traverse((node) => {
              const mesh = node as SkinnedMesh;
              if (!mesh.isSkinnedMesh) return;
              const material = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).find((item) => item.userData.garmentCoverage === "closed");
              if (!material) return;
              const rest = new THREE.Matrix4().fromArray(material.userData.restTransform), positions = mesh.geometry.getAttribute("position");
              for (let i = 0; i < positions.count; i++) hem = Math.min(hem, new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(rest).y);
            });
            assert.ok(Number.isFinite(hem));
            const fitted = bottoms(character);
            assert.ok(fitted.some((mesh) => mesh.geometry.userData.avatarFit === "closed-layer"));
            let releases = 0;
            for (const mesh of fitted) {
              const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
              const rest = new THREE.Matrix4().fromArray(material.userData.restTransform), positions = mesh.geometry.getAttribute("position");
              for (let i = 0; i < positions.count; i++) assert.ok(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(rest).y <= hem + 0.00401, `${body} ${top} retains hidden trousers`);
              mesh.geometry.addEventListener("dispose", () => releases++);
            }
            character.dispose();
            assert.equal(releases, fitted.length);
            assert.equal(sharedDisposals, 0);
            assert.deepEqual(originals.map((geometry) => Array.from(geometry.getAttribute("position").array)), before);
          } finally { character.dispose(); }
        }
      } finally { control.dispose(); }
    }
  });

  await t.test("all selectable outfits have normals, four slots and compatible bones", async () => {
    for (const body of ["m", "f"] as const) {
      for (const outfit of OUTFITS[body]) {
        const initial = decodeLook(encodeLook({ ...DEFAULT_LOOK, body }));
        const look = encodeLook({ ...initial, ...Object.fromEntries((outfit.slots ?? SLOTS).map((slot) => [slot, outfit.id])) });
        const character = new Character(look);
        const control = new Character(look);
        try {
          await loaded(character);
          await loaded(control);
          const bones = new Set<Bone>();
          character.root.traverse((node) => { if ((node as Bone).isBone) bones.add(node as Bone); });
          const slots = new Set<string>();
          character.root.traverse((node) => {
            const mesh = node as SkinnedMesh;
            if (!mesh.isSkinnedMesh) return;
            const normals = mesh.geometry.getAttribute("normal");
            assert.ok(normals && normals.count > 0);
            assert.ok(Array.from(normals.array).every(Number.isFinite));
            assert.ok(mesh.skeleton.bones.every((bone) => bones.has(bone)));
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) {
              slots.add(material.name.split(":")[0]);
              assert.equal((material as MeshStandardMaterial).flatShading, false);
            }
          });
          assert.deepEqual([...slots].sort(), [...SLOTS].sort());
          character.playEmote("Wave");
          character.update(0.7, 0);
          control.update(0.7, 0);
          assert.notDeepEqual(rotations(character), rotations(control));
          const geometry: THREE.BufferGeometry[] = [];
          const controlGeometry: THREE.BufferGeometry[] = [];
          character.root.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) geometry.push((node as SkinnedMesh).geometry); });
          control.root.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) controlGeometry.push((node as SkinnedMesh).geometry); });
          assert.ok(geometry.some((item, i) => item === controlGeometry[i]));
          for (const [i, item] of geometry.entries()) assert.equal(item === controlGeometry[i], !item.userData.avatarFit, `${body} ${outfit.id} geometry ownership`);
        } finally {
          character.dispose();
          control.dispose();
        }
      }
    }
    assert.ok([...requested].every((url) => /^[a-f0-9]{12}$/.test(new URL(url, "http://localhost").searchParams.get("v") ?? "")));
    for (const body of ["m", "f"] as const) for (const outfit of OUTFITS[body]) {
      assert.ok([...requested].some((url) => new URL(url, "http://localhost").pathname.replace(/^\/campus\//, "/").endsWith(`${body}-${outfit.id}.glb`)), `${body}-${outfit.id} was not loaded`);
    }
  });

  await t.test("new hairstyles follow the head during movement and use the selected hair colour", async () => {
    for (const body of ["m", "f"] as const) for (const outfit of OUTFITS[body].filter((outfit) => outfit.hairstyle)) {
      const parts = createStudentHair(body, outfit.hairstyle!);
      const expected = new THREE.Box3();
      for (const part of parts) {
        part.geometry.computeBoundingBox(); expected.union(part.geometry.boundingBox!); part.geometry.dispose();
      }
      const character = new Character(encodeLook({ ...DEFAULT_LOOK, body, head: outfit.id, top: "medical", bottom: "medical", shoes: "clogs", hair: 6, skin: 5 }));
      try {
        await character.whenReady();
        const meshes: SkinnedMesh[] = [];
        character.root.traverse((node) => {
          const mesh = node as SkinnedMesh;
          if (!mesh.isSkinnedMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          if (!materials.every((material) => material.name.startsWith("head:"))) return;
          meshes.push(mesh);
          const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
          for (let i = 0; i < joints.count; i++) {
            assert.equal(mesh.skeleton.bones[joints.getX(i)].name, "Head");
            assert.equal(weights.getX(i), 1);
          }
          for (const material of materials) {
            const role = material.name.split(":")[1], hair = new THREE.Color(HAIR_COLORS[6]);
            const color = role === "hair_fade" ? new THREE.Color(SKIN_TONES[5]).lerp(hair, 0.48) : role === "hair_shade" ? hair.multiplyScalar(0.75) : role === "hair" ? hair : new THREE.Color(0xb4a68b);
            assert.equal((material as MeshStandardMaterial).color.getHex(), color.getHex());
          }
        });
        assert.ok(meshes.length > 0);
        character.playEmote("Wave");
        for (const speed of [0, 2, 5]) {
          character.update(0.5, speed); character.root.updateMatrixWorld(true);
          const face = character.root.getObjectByName("student-face")!;
          const inverse = face.matrixWorld.clone().invert(), actual = new THREE.Box3(), point = new THREE.Vector3();
          for (const mesh of meshes) {
            mesh.skeleton.update();
            const positions = mesh.geometry.getAttribute("position");
            for (let i = 0; i < positions.count; i++) actual.expandByPoint(mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
          }
          assert.ok(actual.min.distanceTo(expected.min) < 0.002 && actual.max.distanceTo(expected.max) < 0.002, `${body} ${outfit.id} is detached from the face at speed ${speed}`);
        }
      } finally { character.dispose(); }
    }
  });

  await t.test("changing clothes during a wave does not block walking on the new rig", async () => {
    const initial = encodeLook(DEFAULT_LOOK);
    const mixed = encodeLook({ ...DEFAULT_LOOK, head: "street", top: "casual", bottom: "hoodie", shoes: "beach" });
    const character = new Character(initial);
    const control = new Character(mixed);
    try {
      await loaded(character);
      await loaded(control);
      assert.ok(character.root.getObjectByName("student-face"));
      character.playEmote("Wave");
      character.update(0.6, 0);
      const previous = character.root.children[0];
      character.setLook(mixed);
      await loaded(character, previous);
      character.update(0.6, 2);
      control.update(0.6, 2);
      assert.deepEqual(rotations(character), rotations(control));
    } finally {
      character.dispose();
      control.dispose();
    }
  });

  await t.test("activity transitions fade out the prior action and restore one-shot interaction", async () => {
    const character = new Character(encodeLook(DEFAULT_LOOK));
    try {
      await character.whenReady();
      const actions = (character as unknown as { actions: Map<string, THREE.AnimationAction> }).actions;
      character.update(0.4, 2);
      let previous = actions.get("Walk")!;
      for (const [pose, animation] of [["sit", "Idle"], ["busy", "Interact"], ["dance", "Run"], ["stand", "Idle"]] as const) {
        character.setPose(pose); character.update(0.4, 0);
        const active = actions.get(animation)!;
        assert.equal(previous.getEffectiveWeight(), 0, `${pose} retains the previous animation`);
        assert.ok(active.isRunning() && active.getEffectiveWeight() > 0.99, `${pose} did not activate ${animation}`);
        assert.equal(actions.get("Interact")!.loop, pose === "busy" ? THREE.LoopRepeat : THREE.LoopOnce);
        previous = active;
      }
    } finally { character.dispose(); }
  });

  await t.test("sitting aligns thighs, calves and feet on both bodies and recovers normal movement", async () => {
    for (const body of ["m", "f"] as const) {
      const look = encodeLook({ ...DEFAULT_LOOK, body, head: "afro", top: "nursing", bottom: "nursing", shoes: "loafers" });
      const seated = new Character(look), standing = new Character(look);
      try {
        await Promise.all([seated.whenReady(), standing.whenReady()]);
        seated.update(0.5, 0); standing.update(0.5, 0);
        seated.setPose("sit"); seated.update(0.5, 0); standing.update(0.5, 0);
        seated.root.position.set(3, 0.2, -4); seated.root.rotation.y = 1.1;
        seated.root.updateMatrixWorld(true);
        let skeleton: THREE.Skeleton | undefined;
        seated.root.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) skeleton ??= (node as SkinnedMesh).skeleton; });
        assert.ok(skeleton);
        const heading = seated.root.getWorldQuaternion(new THREE.Quaternion()).invert();
        for (const side of ["L", "R"]) {
          const hip = seated.root.getObjectByName(`UpperLeg${side}`)!;
          const knee = seated.root.getObjectByName(`LowerLeg${side}`)!;
          const foot = seated.root.getObjectByName(`Foot${side}`)!;
          assert.ok(hip && knee && foot);
          const thigh = knee.getWorldPosition(new THREE.Vector3()).sub(hip.getWorldPosition(new THREE.Vector3())).applyQuaternion(heading).normalize();
          const calf = foot.getWorldPosition(new THREE.Vector3()).sub(knee.getWorldPosition(new THREE.Vector3())).applyQuaternion(heading).normalize();
          assert.ok(thigh.z > 0.99 && Math.abs(thigh.y) < 0.01, `${body} ${side} seated thigh points sideways or backward`);
          assert.ok(calf.y < -0.99, `${body} ${side} seated calf does not descend`);
          const kneeIndex = skeleton.bones.indexOf(knee as Bone), footIndex = skeleton.bones.indexOf(foot as Bone);
          const binding = skeleton.boneInverses[kneeIndex].clone().multiply(skeleton.boneInverses[footIndex].clone().invert());
          const actual = knee.matrixWorld.clone().invert().multiply(foot.matrixWorld);
          assert.ok(actual.elements.every((value, i) => Math.abs(value - binding.elements[i]) < 0.0001), `${body} ${side} seated foot is detached from its calf`);
        }
        seated.setPose("stand");
        for (const speed of [0, 2, 5]) {
          seated.update(0.3, speed); standing.update(0.3, speed);
          for (const side of ["L", "R"]) {
            const foot = seated.root.getObjectByName(`Foot${side}`)!, control = standing.root.getObjectByName(`Foot${side}`)!;
            assert.ok(foot.position.distanceTo(control.position) < 0.0001 && foot.quaternion.clone().normalize().angleTo(control.quaternion.clone().normalize()) < 0.0001, `${body} ${side} foot did not recover after sitting`);
          }
        }
      } finally { seated.dispose(); standing.dispose(); }
    }
  });

  await t.test("new shoes stay connected to the trouser hems while standing, walking, running and sitting", async () => {
    for (const body of ["m", "f"] as const) for (const shoes of FOOTWEAR_STYLES) {
      const character = new Character(encodeLook({ ...DEFAULT_LOOK, body, head: "casual", bottom: "casual", shoes }));
      try {
        await character.whenReady(); character.root.updateMatrixWorld(true);
        const cuffs: { mesh: SkinnedMesh; index: number }[] = [], ankles: { mesh: SkinnedMesh; index: number }[] = [];
        character.root.traverse((node) => {
          const mesh = node as SkinnedMesh;
          if (!mesh.isSkinnedMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const bottom = materials.some((material) => material.name.startsWith("bottom:"));
          const bootTop = Object.hasOwn(BOOT_SHAFTS, shoes) ? BOOT_SHAFTS[shoes].at(-1)![0] : undefined;
          const ankle = materials.some((material) => bootTop ? ["shoes:primary", "shoes:primary_shade"].includes(material.name) : material.name === "shoes:skin");
          if (!bottom && !ankle) return;
          const rest = new THREE.Matrix4().fromArray(materials[0].userData.restTransform);
          const positions = mesh.geometry.getAttribute("position"), point = new THREE.Vector3();
          let hem = Infinity;
          if (bottom) for (let i = 0; i < positions.count; i++) hem = Math.min(hem, point.fromBufferAttribute(positions, i).applyMatrix4(rest).y);
          for (let i = 0; i < positions.count; i++) {
            const height = point.fromBufferAttribute(positions, i).applyMatrix4(rest).y;
            if (bottom && height <= hem + 0.005) cuffs.push({ mesh, index: i });
            if (ankle && (bootTop ? Math.abs(height - bootTop) < 0.016 : height >= 0.135 && height <= 0.15)) ankles.push({ mesh, index: i });
          }
        });
        assert.ok(cuffs.length && ankles.length, `${body} ${shoes} is missing its ankle connection`);
        for (const activity of ["idle", "walk", "run", "sit"] as const) {
          character.setPose(activity === "sit" ? "sit" : "stand");
          const speed = activity === "walk" ? 2 : activity === "run" ? 5 : 0;
          for (let frame = 0; frame < 8; frame++) {
            character.update(0.1, speed); character.root.updateMatrixWorld(true);
            character.root.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh) (node as SkinnedMesh).skeleton.update(); });
            const anklePoints = ankles.map(({ mesh, index }) => mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
            for (const { mesh, index } of cuffs) {
              const point = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
              const distance = Math.min(...anklePoints.map((ankle) => point.distanceTo(ankle)));
              assert.ok(distance < 0.045, `${body} ${shoes} has a ${(distance * 100).toFixed(1)} cm gap while ${activity}`);
            }
          }
        }
      } finally { character.dispose(); }
    }
  });

  await t.test("trousers fit inside tall boots without changing or disposing cached clothing", async () => {
    for (const body of ["m", "f"] as const) {
      const control = new Character(encodeLook({ ...DEFAULT_LOOK, body, head: "casual", bottom: "casual", shoes: "loafers" }));
      await control.whenReady();
      const bottoms = (character: Character) => {
        const meshes: SkinnedMesh[] = [];
        character.root.traverse((node) => {
          const mesh = node as SkinnedMesh;
          if (!mesh.isSkinnedMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          if (materials.some((material) => material.name.startsWith("bottom:"))) meshes.push(mesh);
        });
        return meshes;
      };
      const original = bottoms(control).map((mesh) => mesh.geometry);
      const before = original.map((geometry) => Array.from(geometry.getAttribute("position").array));
      let cachedDisposals = 0;
      original.forEach((geometry) => geometry.addEventListener("dispose", () => cachedDisposals++));
      try {
        for (const shoes of ["hightops", "ankleboots", "wellies"]) {
          const character = new Character(encodeLook({ ...DEFAULT_LOOK, body, head: "casual", bottom: "casual", shoes }));
          await character.whenReady(); character.root.updateMatrixWorld(true);
          const meshes = bottoms(character);
          const privateGeometry = meshes.map((mesh) => mesh.geometry).filter((geometry, i) => geometry !== original[i]);
          assert.ok(privateGeometry.length > 0);
          let ownedDisposals = 0;
          privateGeometry.forEach((geometry) => geometry.addEventListener("dispose", () => ownedDisposals++));
          const rings = BOOT_SHAFTS[shoes], height = rings.at(-1)![0];
          for (const mesh of meshes) {
            const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            const rest = new THREE.Matrix4().fromArray(material.userData.restTransform);
            const positions = mesh.geometry.getAttribute("position");
            const bands = new Map<number, THREE.Box3>([[-1, new THREE.Box3()], [1, new THREE.Box3()]]);
            for (let i = 0; i < positions.count; i++) {
              const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(rest);
              assert.ok(point.y >= height - 0.0081, `${body} ${shoes} leaves trousers inside the shaft`);
              if (point.y < height + 0.01) bands.get(Math.sign(point.x))!.expandByPoint(point);
            }
            for (const band of bands.values()) {
              const width = band.getSize(new THREE.Vector3()).x;
              assert.ok(width < Math.max(...rings.map((ring) => ring[1])) * 2 * (body === "f" ? 0.84 : 1), `${body} ${shoes} trouser is wider than its boot`);
            }
          }
          character.dispose();
          assert.equal(ownedDisposals, privateGeometry.length);
          assert.equal(cachedDisposals, 0);
        }
        assert.deepEqual(original.map((geometry) => Array.from(geometry.getAttribute("position").array)), before);
      } finally { control.dispose(); }
    }
  });
});

test("shared faces blink, follow the viewer and keep colours independent", (t) => {
  t.mock.method(Math, "random", () => 0);
  const face = new StudentFace(DEFAULT_LOOK);
  const other = new StudentFace({ ...DEFAULT_LOOK, skin: 0 });
  const skin = face.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const otherSkin = other.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  assert.equal(skin.geometry, otherSkin.geometry);
  assert.notEqual(skin.material, otherSkin.material);
  assert.notEqual(skin.material.color.getHex(), otherSkin.material.color.getHex());
  const eye = face.root.getObjectByName("eye-left")!;
  face.update(2.99);
  assert.equal(eye.scale.y, 1);
  face.update(0.02);
  face.update(0.07);
  assert.ok(eye.scale.y < 0.05);
  face.update(0.1);
  assert.ok(Math.abs(eye.scale.y - 1) < 1e-8);
  face.root.updateMatrixWorld(true);
  face.lookAt(new THREE.Vector3(1, 2, 4));
  const iris = eye.getObjectByName("iris")!;
  assert.ok(iris.position.x > 0 && iris.position.x <= 0.007);
  assert.ok(Math.abs(iris.position.y) <= 0.004);
  let triangles = 0;
  face.root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
  });
  assert.ok(triangles < 5000, `${triangles} face triangles`);
});

test("studio framing fits a full student and close-ups at narrow and wide sizes", () => {
  for (const body of ["m", "f"] as const) for (const aspect of [0.35, 0.8, 1, 2.4]) {
    const full = studioFraming("full", aspect, body);
    const verticalSpan = full.distance * 2 * Math.tan(26 * Math.PI / 360);
    assert.ok(verticalSpan >= full.height);
    assert.ok(verticalSpan * aspect >= 1.25 - 1e-8);
    for (const focus of ["hair", "shoes"] as const) {
      const detail = studioFraming(focus, aspect, body);
      assert.ok(detail.distance < full.distance);
      assert.ok(detail.center > 0);
    }
  }
});

test("asset versions match the rebuilt files so old faceted models cannot remain cached", async () => {
  for (const [file, version] of Object.entries(CHARACTER_ASSET_VERSIONS)) {
    const bytes = await readFile(new URL(`../public/models/chars/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), version);
  }
});
