import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as THREE from "three";
import type { GLTFLoader as Loader } from "three/addons/loaders/GLTFLoader.js";
import {
  CLOTH_COLORS,
  DEFAULT_LOOK,
  SKIN_TONES,
  STUDENT_OUTFITS,
  encodeLook,
  slotOptions,
  type Look,
  type Slot,
} from "@campuslife/shared/avatar";
import { Character } from "../game/characters.ts";

const require = createRequire(import.meta.url);
const { GLTFLoader } = require("three/addons/loaders/GLTFLoader.js") as { GLTFLoader: typeof Loader };
const ATTACHED_DETAILS = new Set(["pocket", "collar", "badge", "seam", "trim", "button"]);
const FITTED_PATCHES = new Set(["pocket", "badge"]);

function materials(mesh: THREE.SkinnedMesh): THREE.MeshStandardMaterial[] {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
}

function meshes(character: Character, slot?: Slot) {
  const result: THREE.SkinnedMesh[] = [];
  character.root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && (!slot || materials(mesh).some((material) => material.name.startsWith(`${slot}:`)))) result.push(mesh);
  });
  return result;
}

function updateWorld(character: Character) {
  character.root.updateMatrixWorld(true);
  for (const mesh of meshes(character)) mesh.skeleton.update();
}

function vertices(mesh: THREE.SkinnedMesh) {
  return Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, i) =>
    mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
}

function surface(shells: THREE.SkinnedMesh[], rest = false) {
  const triangles: { triangle: THREE.Triangle; bounds: THREE.Box3 }[] = [];
  for (const mesh of shells) {
    const points = rest ? restVertices(mesh) : vertices(mesh);
    const indices = mesh.geometry.index;
    const count = indices?.count ?? points.length;
    for (let i = 0; i < count; i += 3) {
      const triangle = new THREE.Triangle(
        points[indices?.getX(i) ?? i],
        points[indices?.getX(i + 1) ?? i + 1],
        points[indices?.getX(i + 2) ?? i + 2],
      );
      triangles.push({ triangle, bounds: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]) });
    }
  }
  return triangles;
}

function nearestProjection(point: THREE.Vector3, triangles: ReturnType<typeof surface>) {
  let distance = Infinity, signed = Infinity, index = -1;
  const closest = new THREE.Vector3(), normal = new THREE.Vector3();
  for (const [candidate, { triangle, bounds }] of triangles.entries()) {
    if (bounds.distanceToPoint(point) >= distance) continue;
    triangle.closestPointToPoint(point, closest);
    const separation = closest.distanceTo(point);
    if (separation >= distance) continue;
    distance = separation;
    signed = point.clone().sub(closest).dot(triangle.getNormal(normal));
    index = candidate;
  }
  return { distance, signed, index };
}

function nearestDistance(point: THREE.Vector3, triangles: ReturnType<typeof surface>) {
  return nearestProjection(point, triangles).distance;
}

function assertRig(character: Character, label: string) {
  const bones = new Set<THREE.Bone>();
  character.root.traverse((node) => { if ((node as THREE.Bone).isBone) bones.add(node as THREE.Bone); });
  for (const mesh of meshes(character)) {
    assert.ok(mesh.skeleton.bones.every((bone) => bones.has(bone)), `${label} references another character's bones`);
    const positions = mesh.geometry.getAttribute("position");
    const joints = mesh.geometry.getAttribute("skinIndex");
    const weights = mesh.geometry.getAttribute("skinWeight");
    assert.equal(weights.count, positions.count, `${label} has unweighted vertices`);
    for (let i = 0; i < weights.count; i++) {
      let total = 0;
      for (let component = 0; component < 4; component++) {
        const weight = weights.getComponent(i, component);
        assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1, `${label} has invalid skin weights`);
        total += weight;
        if (weight > 0) {
          const bone = mesh.skeleton.bones[joints.getComponent(i, component)];
          assert.ok(bone, `${label} has a missing bone`);
          const part = mesh.geometry.userData.garmentPart;
          if (weight > 0.02 && (part === "shell" || ATTACHED_DETAILS.has(part))) {
            assert.ok(!/^(Pinky|Index|Middle|Ring|Thumb|Foot)/.test(bone.name), `${label} ${part} moves with ${bone.name}`);
          }
        }
      }
      assert.ok(Math.abs(total - 1) < 0.001, `${label} skin weights total ${total}`);
    }
  }
}

function assertAttachments(character: Character, label: string) {
  for (const slot of ["top", "bottom"] as const) {
    const pieces = meshes(character, slot);
    const shells = pieces.filter((mesh) => mesh.geometry.userData.garmentPart === "shell");
    const details = pieces.filter((mesh) => ATTACHED_DETAILS.has(mesh.geometry.userData.garmentPart));
    if (!details.length) continue;
    assert.ok(shells.length, `${label} ${slot} has details without a supporting garment`);
    const triangles = surface(shells);
    const restTriangles = surface(shells, true);
    for (const detail of details) {
      const part = detail.geometry.userData.garmentPart as string;
      let maximum = 0;
      for (const point of vertices(detail)) maximum = Math.max(maximum, nearestDistance(point, triangles));
      assert.ok(maximum <= 0.012, `${label} ${part} floats ${(maximum * 100).toFixed(1)} cm from its garment`);
      if (FITTED_PATCHES.has(part) || slot === "top" && character.look.top === "agric" && part === "trim") {
        let inward = 0;
        const restPatch = surface([detail], true);
        for (const [index, { triangle }] of surface([detail]).entries()) {
          const center = triangle.getMidpoint(new THREE.Vector3());
          const source = restPatch[index].triangle.getMidpoint(new THREE.Vector3());
          const support = triangles[nearestProjection(source, restTriangles).index].triangle;
          const closest = support.closestPointToPoint(center, new THREE.Vector3());
          const signed = center.clone().sub(closest).dot(support.getNormal(new THREE.Vector3()));
          inward = Math.max(inward, -signed);
        }
        assert.ok(inward <= 0.001, `${label} ${part} triangle cuts ${(inward * 1000).toFixed(2)} mm inside its garment`);
      }
    }
  }
}

function restVertices(mesh: THREE.SkinnedMesh) {
  const positions = mesh.geometry.getAttribute("position");
  const material = materials(mesh)[0];
  const transform = new THREE.Matrix4().fromArray(material.userData.restTransform);
  return Array.from({ length: positions.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(transform));
}

function upperEdge(mesh: THREE.SkinnedMesh) {
  const rest = restVertices(mesh);
  const highest = Math.max(...rest.map((point) => point.y));
  return rest.flatMap((point, i) => highest - point.y < 0.001 ? [i] : []);
}

function assertCoverage(character: Character, label: string) {
  const top = meshes(character, "top");
  const torso = top.filter((mesh) => mesh.geometry.userData.garmentPart === "shell" && mesh.geometry.userData.garmentRegion === "torso");
  const extensions = top.filter((mesh) => mesh.geometry.userData.garmentPart === "shell" && mesh.geometry.userData.garmentRegion === "hem");
  const skirts = meshes(character, "bottom").filter((mesh) => mesh.geometry.userData.garmentPart === "shell" && mesh.geometry.userData.garmentRegion === "skirt");
  if (!extensions.length && !skirts.length) return;
  assert.ok(torso.length, `${label} has no torso supporting its extended garment`);
  const triangles = surface(torso);
  for (const extension of [...extensions, ...skirts]) {
    if (extension.geometry.userData.garmentRegion === "skirt" && extension.geometry.userData.avatarFit === "closed-layer") continue;
    const edge = upperEdge(extension);
    assert.ok(edge.length >= 3, `${label} has no upper garment seam`);
    for (const index of edge) {
      const point = extension.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(extension.matrixWorld);
      const distance = nearestDistance(point, triangles);
      assert.ok(distance <= 0.012, `${label} ${extension.geometry.userData.garmentRegion} has a ${(distance * 100).toFixed(1)} cm gap at its waist seam`);
    }
  }
}

function assertBodyCoverage(character: Character, label: string) {
  const covers = meshes(character).filter((mesh) => mesh.geometry.userData.garmentPart === "shell" && ["hem", "skirt"].includes(mesh.geometry.userData.garmentRegion));
  const underlays = meshes(character, "bottom").filter((mesh) => mesh.geometry.userData.garmentRegion === "legs");
  for (const cover of covers) {
    const rest = restVertices(cover), bounds = new THREE.Box3().setFromPoints(rest);
    const margin = bounds.getSize(new THREE.Vector3()).y * 0.035;
    const triangles = surface([cover]);
    for (const underlay of underlays) {
      const restBody = restVertices(underlay);
      for (const [index, original] of restBody.entries()) {
        if (original.y <= bounds.min.y + margin || original.y >= bounds.max.y - margin) continue;
        const point = underlay.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(underlay.matrixWorld);
        const { signed } = nearestProjection(point, triangles);
        assert.ok(signed <= 0.003, `${label} lower body protrudes ${(signed * 100).toFixed(1)} cm through its ${cover.geometry.userData.garmentRegion}`);
      }
    }
  }
}

function assertClosedCoverage(character: Character, label: string) {
  const covers = meshes(character).filter((mesh) => mesh.geometry.userData.garmentPart === "shell" && ["hem", "skirt"].includes(mesh.geometry.userData.garmentRegion));
  for (const cover of covers) {
    const points = restVertices(cover), bounds = new THREE.Box3().setFromPoints(points), indices = cover.geometry.index!;
    const key = (point: THREE.Vector3) => point.toArray().map((component) => Math.round(component / 0.0001)).join(":");
    for (const progress of [0.17, 0.47, 0.73]) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, progress));
      const degree = new Map<string, number>();
      const line = new THREE.Line3();
      for (let i = 0; i < indices.count; i += 3) {
        const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)], hits = new Map<string, THREE.Vector3>();
        for (let edge = 0; edge < 3; edge++) {
          line.set(points[triangle[edge]], points[triangle[(edge + 1) % 3]]);
          const intersection = plane.intersectLine(line, new THREE.Vector3());
          if (intersection) hits.set(key(intersection), intersection);
        }
        if (hits.size !== 2) continue;
        for (const id of hits.keys()) degree.set(id, (degree.get(id) ?? 0) + 1);
      }
      assert.ok(degree.size >= 8, `${label} has no surrounding fabric at ${progress * 100}% of its ${cover.geometry.userData.garmentRegion}`);
      assert.ok([...degree.values()].every((count) => count === 2), `${label} ${cover.geometry.userData.garmentRegion} has an open fabric section at ${progress * 100}% of its length`);
    }
  }
}

function assertExposedLegs(character: Character, label: string, seated: boolean) {
  const legs = meshes(character, "bottom").filter((mesh) => mesh.geometry.userData.garmentPart === "skin" && mesh.geometry.userData.garmentRegion === "legs");
  assert.ok(legs.length, `${label} has no exposed legs beneath its hem`);
  const name = (value: string) => value.replace(/[._]/g, "");
  const bone = (joint: string) => {
    let result: THREE.Bone | undefined;
    character.root.traverse((node) => {
      if ((node as THREE.Bone).isBone && name(node.name) === name(joint)) result = node as THREE.Bone;
    });
    return result;
  };
  for (const side of ["L", "R"]) {
    const knee = bone(`LowerLeg.${side}`);
    const ankle = bone(`Foot.${side}`);
    assert.ok(knee && ankle, `${label} has no ${side} leg anatomy`);
    const from = knee.getWorldPosition(new THREE.Vector3());
    const skeleton = legs[0].skeleton;
    const kneeIndex = skeleton.bones.indexOf(knee), ankleIndex = skeleton.bones.indexOf(ankle);
    assert.ok(kneeIndex >= 0 && ankleIndex >= 0, `${label} has no lower-leg bind reference`);
    const ankleBinding = skeleton.boneInverses[kneeIndex].clone().multiply(skeleton.boneInverses[ankleIndex].clone().invert());
    const to = new THREE.Vector3().setFromMatrixPosition(ankleBinding).applyMatrix4(knee.matrixWorld);
    if (seated) {
      const actual = ankle.getWorldPosition(new THREE.Vector3());
      assert.ok(actual.distanceTo(to) < 0.004, `${label} ${side} shoe remains detached from its bent leg`);
      const thigh = bone(`UpperLeg.${side}`)!;
      const rotation = character.root.getWorldQuaternion(new THREE.Quaternion());
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(rotation);
      const upperDirection = from.clone().sub(thigh.getWorldPosition(new THREE.Vector3())).normalize();
      const lowerDirection = to.clone().sub(from).normalize();
      assert.ok(upperDirection.dot(forward) > 0.9, `${label} ${side} seated thigh points sideways or backwards`);
      assert.ok(lowerDirection.dot(down) > 0.9, `${label} ${side} seated calf does not point down`);
    }
    const axis = to.clone().sub(from).normalize();
    const across = new THREE.Vector3(1, 0, 0).projectOnPlane(axis).normalize();
    const depth = new THREE.Vector3().crossVectors(axis, across).normalize();
    for (const progress of [0.25, 0.5, 0.75]) {
      const center = from.clone().lerp(to, progress);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, center);
      const intersections: THREE.Vector3[] = [];
      const line = new THREE.Line3();
      for (const mesh of legs) {
        const points = vertices(mesh), indices = mesh.geometry.index!;
        const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
        const belongs = (index: number) => {
          let weight = 0;
          for (let component = 0; component < 4; component++) if (/^(UpperLeg|LowerLeg|Foot)/.test(name(mesh.skeleton.bones[joints.getComponent(index, component)].name)) && name(mesh.skeleton.bones[joints.getComponent(index, component)].name).endsWith(side)) weight += weights.getComponent(index, component);
          return weight > 0.1;
        };
        for (let i = 0; i < indices.count; i += 3) {
          const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
          if (!triangle.some(belongs)) continue;
          for (let edge = 0; edge < 3; edge++) {
            line.set(points[triangle[edge]], points[triangle[(edge + 1) % 3]]);
            const intersection = plane.intersectLine(line, new THREE.Vector3());
            if (intersection) intersections.push(intersection);
          }
        }
      }
      assert.ok(intersections.length >= 6, `${label} ${side} calf is missing at ${progress * 100}% of its length`);
      for (const direction of [across, depth]) {
        const distances = intersections.map((point) => point.clone().sub(center).dot(direction));
        assert.ok(Math.min(...distances) < 0 && Math.max(...distances) > 0, `${label} ${side} exposed leg fails to enclose its bone`);
      }
    }
  }
}

function assertColors(character: Character, look: Look) {
  for (const mesh of meshes(character)) for (const material of materials(mesh)) {
    const [slot, role] = material.name.split(":");
    if (role === "primary" && ["top", "bottom", "shoes"].includes(slot)) {
      const color = slot === "top" ? look.topColor : slot === "bottom" ? look.bottomColor : look.shoesColor;
      assert.equal(material.color.getHex(), CLOTH_COLORS[color], `${slot} lost its selected colour`);
    }
    if (role === "skin") assert.equal(material.color.getHex(), SKIN_TONES[look.skin], `${slot} has clothing-coloured exposed skin`);
  }
}

test("student clothing fits the shared body rig and stays attached through activities", async (t) => {
  t.mock.method(GLTFLoader.prototype, "loadAsync", async function (this: Loader, url: string) {
    const pathname = new URL(url, "http://localhost").pathname.replace(/^\/campus\//, "/");
    const bytes = await readFile(new URL(`../public${pathname}`, import.meta.url));
    return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  });

  for (const body of ["m", "f"] as const) {
    await t.test(`${body} garments fit through activities`, async (bodyTest) => {
      const outfits = slotOptions(body, "top").filter((outfit) => outfit.style);
      for (const outfit of outfits) {
        await bodyTest.test(outfit.id, async () => {
          const bottom = slotOptions(body, "bottom").some((option) => option.id === outfit.id) ? outfit.id : "nursing";
          const character = new Character(encodeLook({ ...DEFAULT_LOOK, body, head: "afro", top: outfit.id, bottom, shoes: "loafers" }));
          try {
            await character.whenReady();
            assertRig(character, `${body} ${outfit.id}`);
            assertClosedCoverage(character, `${body} ${outfit.id}`);
            const top = meshes(character, "top");
            assert.ok(top.some((mesh) => mesh.geometry.userData.garmentPart === "shell"), `${body} ${outfit.id} has no fitted shell`);
            assert.ok(top.some((mesh) => ATTACHED_DETAILS.has(mesh.geometry.userData.garmentPart)), `${body} ${outfit.id} has no designed details`);
            for (const activity of ["idle", "walk", "run", "wave", "sit"] as const) {
              character.setPose(activity === "sit" ? "sit" : "stand");
              if (activity === "wave") character.playEmote("Wave");
              const speed = activity === "walk" ? 2 : activity === "run" ? 5 : 0;
              for (const interval of [0.3, 0.5, 0.6]) {
                character.update(interval, speed);
                updateWorld(character);
                assertAttachments(character, `${body} ${outfit.id} ${activity}`);
                assertCoverage(character, `${body} ${outfit.id} ${activity}`);
                assertBodyCoverage(character, `${body} ${outfit.id} ${activity}`);
                if (outfit.id === "sports" || outfit.id === "dress") assertExposedLegs(character, `${body} ${outfit.id} ${activity}`, activity === "sit");
              }
            }
          } finally { character.dispose(); }
        });
      }
    });
  }

  await t.test("the earlier agriculture bib clearance is rejected against its sewn fabric", async () => {
    const character = new Character(encodeLook({ ...DEFAULT_LOOK, body: "m", head: "afro", top: "agric", bottom: "agric", shoes: "loafers" }));
    let bib: THREE.SkinnedMesh | undefined, original: THREE.BufferGeometry | undefined, legacy: THREE.BufferGeometry | undefined;
    try {
      await character.whenReady();
      const top = meshes(character, "top"), shells = top.filter((mesh) => mesh.geometry.userData.garmentPart === "shell");
      const patches = top.filter((mesh) => mesh.geometry.userData.garmentPart === "trim");
      const area = (mesh: THREE.SkinnedMesh) => {
        const size = new THREE.Box3().setFromPoints(restVertices(mesh)).getSize(new THREE.Vector3());
        return size.x * size.y;
      };
      bib = patches.sort((a, b) => area(b) - area(a))[0];
      assert.ok(bib, "agriculture has no bib panel");
      character.update(0.3, 0);
      updateWorld(character);
      assertAttachments(character, "fitted agriculture bib");
      original = bib.geometry;
      legacy = original.clone();
      const restShells = surface(shells, true), inverse = new THREE.Matrix4().fromArray(materials(bib)[0].userData.restTransform).invert();
      const positions = restVertices(bib).flatMap((point) => {
        const support = restShells[nearestProjection(point, restShells).index].triangle;
        return point.addScaledVector(support.getNormal(new THREE.Vector3()), -0.003).applyMatrix4(inverse).toArray();
      });
      legacy.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      bib.geometry = legacy;
      updateWorld(character);
      assert.throws(() => assertAttachments(character, "earlier agriculture bib"), /trim triangle cuts .* mm inside its garment/);
    } finally {
      if (bib && original) bib.geometry = original;
      legacy?.dispose();
      character.dispose();
    }
  });

  await t.test("all coordinated looks and mixed garments preserve independent colours", async () => {
    for (const body of ["m", "f"] as const) {
      const control = new Character(encodeLook({ ...DEFAULT_LOOK, body, head: "afro", top: "nursing", bottom: "nursing", shoes: "loafers" }));
      try {
        await control.whenReady();
        const originalColors = meshes(control).flatMap((mesh) => materials(mesh).map((material) => material.color.getHex()));
        for (const outfit of STUDENT_OUTFITS) {
          const look: Look = { ...control.look, ...outfit.looks[body], topColor: 12, bottomColor: 7, shoesColor: 4, skin: 2 };
          const character = new Character(encodeLook(look));
          try {
            await character.whenReady();
            assertColors(character, look);
            assertRig(character, `${body} ${outfit.id}`);
            character.update(0.5, 2);
            updateWorld(character);
            assertAttachments(character, `${body} ${outfit.id} recoloured`);
          } finally { character.dispose(); }
        }
        assert.deepEqual(meshes(control).flatMap((mesh) => materials(mesh).map((material) => material.color.getHex())), originalColors);
        const mixed: Look = { ...control.look, top: "native", bottom: "sports", shoes: "wellies", topColor: 9, bottomColor: 1, shoesColor: 6 };
        control.setLook(encodeLook(mixed));
        await control.whenReady();
        assertColors(control, mixed);
        assertRig(control, `${body} mixed garments`);
        control.playEmote("Wave");
        control.update(0.7, 0);
        updateWorld(control);
        assertAttachments(control, `${body} mixed garments`);
        if (body === "f") {
          const layered: Look = { ...mixed, top: "medical", bottom: "dress", shoes: "loafers" };
          control.setLook(encodeLook(layered));
          await control.whenReady();
          assertColors(control, layered);
          assertRig(control, "layered coat and skirt");
          assertClosedCoverage(control, "layered coat and skirt");
          for (const speed of [0, 2, 5]) {
            control.update(0.6, speed);
            updateWorld(control);
            assertAttachments(control, "layered coat and skirt");
            assertCoverage(control, "layered coat and skirt");
            assertBodyCoverage(control, "layered coat and skirt");
          }
        }
      } finally { control.dispose(); }
    }
  });
});
