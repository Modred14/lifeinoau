import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BodyType, Slot, StudentStyle } from "@campuslife/shared/avatar";
import { garmentButton, surfacePatch, surfacePolygon, surfaceSeam } from "./details.mts";
import { clipGarment, coverSleeve, fittedLoft, skinLegs } from "./geometry.mts";
import { GarmentSurface, type SurfaceHit } from "./measurements.mts";
import { normalizedInfluences, setGeometryInfluences, vertexInfluences } from "./rigging.mts";

export type GarmentPiece = {
  slot: Slot;
  geometry: THREE.BufferGeometry;
  role: string;
  color: number;
  garmentPart: "shell" | "pocket" | "collar" | "badge" | "seam" | "trim" | "button" | "skin";
  garmentRegion: "torso" | "sleeve" | "hem" | "skirt" | "legs" | "arms";
};

export type GarmentSources = { top: THREE.BufferGeometry; arms: THREE.BufferGeometry; bottom: THREE.BufferGeometry; joints: readonly string[] };

function cleanWeights(geometry: THREE.BufferGeometry, names: readonly string[], region: GarmentPiece["garmentRegion"], torsoShell = false) {
  return setGeometryInfluences(geometry, Array.from({ length: geometry.getAttribute("position").count }, (_, i) => vertexInfluences(geometry, i).map(({ joint, weight }) => {
    const name = names[joint];
    if (torsoShell && /^(UpperLeg|LowerLeg)/.test(name)) return { joint: names.indexOf("Hips"), weight };
    if (torsoShell && geometry.getAttribute("position").getY(i) < 1.32 && /^(Shoulder|UpperArm|LowerArm|Wrist)/.test(name)) return { joint: names.indexOf("Torso"), weight };
    if (region !== "arms" && /^(Index|Middle|Ring|Pinky|Thumb)/.test(name)) return { joint: names.indexOf(name.endsWith(".L") ? "LowerArm.L" : "LowerArm.R"), weight };
    if (region !== "arms" && name.startsWith("Foot.")) return { joint: names.indexOf(name.replace("Foot.", "LowerLeg.")), weight };
    return { joint, weight };
  })));
}

function lowerEnvelope(bottom: GarmentSurface, y: number, count = 64) {
  const points = [-0.09, -0.045, 0, 0.045].flatMap((offset) => bottom.section("y", y + offset));
  const bounds = new THREE.Box3().setFromPoints(points), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = i / count * Math.PI * 2, sx = Math.sin(angle), sz = Math.cos(angle);
    return new THREE.Vector3(Math.sign(sx) * Math.abs(sx) ** 0.64 * (size.x / 2 + 0.009), y, center.z + Math.sign(sz) * Math.abs(sz) ** 0.64 * (size.z / 2 + 0.022));
  });
}

function drapeBinding(point: THREE.Vector3, joints: readonly string[], amount: number) {
  const left = THREE.MathUtils.smoothstep(point.x, -0.075, 0.075);
  return [{ joint: joints.indexOf("Hips"), weight: 1 - amount }, { joint: joints.indexOf("UpperLeg.L"), weight: amount * left }, { joint: joints.indexOf("UpperLeg.R"), weight: amount * (1 - left) }];
}

function extension(top: GarmentSurface, bottom: GarmentSurface, cut: number, hem: number, flare: number, joints: readonly string[]) {
  const count = 64, source = top.ring(cut + 0.006, count), hipY = bottom.bounds.max.y - 0.11;
  const hip = lowerEnvelope(bottom, hipY, count);
  const rings: SurfaceHit[][] = [];
  for (let row = 0; row <= 12; row++) {
    const y = THREE.MathUtils.lerp(cut + 0.006, hem, row / 12);
    const t = THREE.MathUtils.smoothstep(cut - y, 0, Math.max(0.025, cut - hipY));
    rings.push(source.map((hit, column) => {
      const target = hip[column].clone(), point = hit.point.clone().lerp(target, t);
      const below = THREE.MathUtils.smoothstep(hipY - y, 0, Math.max(0.02, hipY - hem));
      point.x *= 1 + below * flare;
      point.z = 0.065 + (point.z - 0.065) * (1 + below * flare * 0.65);
      point.y = y;
      const transition = THREE.MathUtils.smoothstep(cut - y, 0.015, Math.max(0.05, cut - hipY));
      const legMotion = THREE.MathUtils.smoothstep(cut - y, 0, cut - hem) ** 1.5;
      const influences = normalizedInfluences([...hit.influences.map(({ joint, weight }) => ({ joint, weight: weight * (1 - transition) })), ...drapeBinding(point, joints, legMotion).map(({ joint, weight }) => ({ joint, weight: weight * transition }))]);
      return { ...hit, point, influences };
    }));
  }
  return fittedLoft(rings);
}

function ringTrim(surface: GarmentSurface, y: number, radius = 0.0011) {
  const hits = surface.ring(y, 32, radius + 0.001), curve = new THREE.CatmullRomCurve3(hits.slice(0, -1).map((hit) => hit.point), true, "centripetal");
  const geometry = new THREE.TubeGeometry(curve, 48, radius, 4, true).deleteAttribute("uv");
  const positions = geometry.getAttribute("position");
  const influences = Array.from({ length: positions.count }, (_, i) => {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i), hit = surface.closest(point);
    if (hit.distance > radius + 0.0015) {
      point.sub(hit.point).normalize().multiplyScalar(radius + 0.0015).add(hit.point);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    return hit.influences;
  });
  geometry.computeVertexNormals();
  return setGeometryInfluences(geometry, influences);
}

export function createStudentGarments(body: BodyType, style: StudentStyle, sources: GarmentSources): GarmentPiece[] {
  cleanWeights(sources.top, sources.joints, "torso", true);
  const pieces: GarmentPiece[] = [], base = new GarmentSurface(sources.top), trouserSurface = new GarmentSurface(sources.bottom);
  const waist = base.bounds.min.y, collarY = Math.min(base.bounds.max.y - 0.028, 1.507);
  const add = (slot: Slot, geometry: THREE.BufferGeometry, garmentPart: GarmentPiece["garmentPart"], garmentRegion: GarmentPiece["garmentRegion"], role = "primary", color = 0xf5f5f0) => {
    geometry.deleteAttribute("uv");
    cleanWeights(geometry, sources.joints, garmentRegion, garmentPart === "shell" && garmentRegion === "torso");
    pieces.push({ slot, geometry, garmentPart, garmentRegion, role, color });
  };
  const coat = style === "medical" || style === "lab", tunic = style === "native";
  let torso = sources.top.clone(), arms = sources.arms.clone();
  if (coat || tunic) {
    const cut = waist + (coat ? 0.085 : 0.055), hem = body === "f" ? coat ? 0.735 : 0.79 : coat ? 0.70 : 0.76;
    const loft = extension(base, trouserSurface, cut, hem, coat ? 0.16 : 0.09, sources.joints);
    torso.dispose(); torso = clipGarment(sources.top, (point) => point.y - cut);
    add("top", loft, "shell", "hem");
    const hemSurface = new GarmentSurface(loft);
    add("top", ringTrim(hemSurface, hem + 0.003), "seam", "hem", "primary_shade", 0xd0cec5);
  }
  add("top", torso, "shell", "torso");
  if (coat || style === "formal") {
    const joined = mergeGeometries([sources.top, sources.arms])!;
    const armSurface = new GarmentSurface(joined);
    const cuff = base.bounds.max.x - 0.018, wrist = 0.544;
    for (const side of [-1, 1] as const) {
      const sleeve = coverSleeve(armSurface, cuff, wrist, side);
      add("top", sleeve, "shell", "sleeve");
      const sleeveSurface = new GarmentSurface(sleeve), end = sleeveSurface.section("x", side * (wrist - 0.004));
      const bounds = new THREE.Box3().setFromPoints(end), center = bounds.getCenter(new THREE.Vector3());
      const points = Array.from({ length: 25 }, (_, i) => {
        const angle = i / 24 * Math.PI * 2, direction = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
        return sleeveSurface.ray(center.clone().addScaledVector(direction, 0.2), direction.clone().negate())!;
      });
      const curve = new THREE.CatmullRomCurve3(points.slice(0, -1).map((hit) => hit.point.clone().addScaledVector(hit.normal, 0.001)), true);
      const trim = new THREE.TubeGeometry(curve, 32, 0.0012, 4, true).deleteAttribute("uv");
      setGeometryInfluences(trim, Array.from({ length: trim.getAttribute("position").count }, (_, i) => sleeveSurface.closest(new THREE.Vector3().fromBufferAttribute(trim.getAttribute("position"), i)).influences));
      add("top", trim, "seam", "sleeve", "primary_shade", 0xd0cec5);
    }
    arms.dispose(); arms = clipGarment(sources.arms, (point) => Math.max(Math.abs(point.x) - (wrist - 0.003), 0.115 - Math.abs(point.x)));
    joined.dispose();
  }
  add("top", arms, "skin", "arms", "skin", 0x82553a);
  const topShell = mergeGeometries(pieces.filter((piece) => piece.slot === "top" && piece.garmentPart === "shell").map((piece) => piece.geometry))!;
  const surface = new GarmentSurface(topShell);
  const pocket = (x: number, y: number, width = 0.063, height = 0.074, role = "primary", region: GarmentPiece["garmentRegion"] = "torso") => {
    add("top", surfacePatch(surface, x, y, width, height, 0.002, 0.13), "pocket", region, role, role === "fixed" ? 0x7a5232 : 0xf5f5f0);
    add("top", surfaceSeam(surface, [[x - width / 2 + 0.004, y + height / 2 - 0.006], [x, y + height / 2 - 0.006], [x + width / 2 - 0.004, y + height / 2 - 0.006]], 0.0009, 0.0065), "seam", region, role === "fixed" ? "fixed" : "primary_shade", 0x9b805d);
  };
  const badge = (x: number, y: number) => {
    add("top", surfacePatch(surface, x, y, 0.028, 0.035, 0.0035), "badge", "torso", "fixed", 0xe7e7df);
    add("top", surfacePatch(surface, x, y + 0.010, 0.021, 0.004, 0.0052), "badge", "torso", "fixed", 0x3c84ac);
  };
  const placketBottom = coat ? waist - 0.20 : waist + 0.018;
  const placket = () => {
    add("top", surfacePatch(surface, 0, (collarY + placketBottom) / 2, 0.015, collarY - placketBottom, 0.002, 0, { sewingClearance: 0 }), "trim", "torso");
    for (let y = collarY - 0.07; y > placketBottom + 0.02; y -= 0.075) add("top", garmentButton(surface, 0, y), "button", y < waist ? "hem" : "torso", "fixed", 0xd9d6c8);
  };
  const foldedCollar = (lapel = false) => {
    for (const side of [-1, 1]) {
      const outline: [number, number][] = lapel
        ? [[side * 0.025, collarY + 0.006], [side * 0.077, collarY - 0.022], [side * 0.039, collarY - 0.145], [side * 0.013, collarY - 0.10]]
        : [[side * 0.022, collarY + 0.007], [side * 0.064, collarY - 0.005], [side * 0.051, collarY - 0.067], [side * 0.008, collarY - 0.034]];
      add("top", surfacePolygon(surface, outline, 0.004), "collar", "torso", "primary_shade", 0xd4d2c8);
      add("top", surfaceSeam(surface, [outline[1], outline[2], outline[3]], 0.00065, 0.0045), "seam", "torso", "primary_shade", 0xc5c3b9);
    }
  };
  if (coat) {
    foldedCollar(true); placket();
    for (const side of [-1, 1]) pocket(side * 0.075, waist + 0.02, 0.066, 0.08, "primary", "hem");
    pocket(-0.069, 1.35, 0.049, 0.052); badge(-0.068, 1.365);
    if (style === "medical") {
      add("top", surfaceSeam(surface, [[-0.058, collarY - 0.035], [-0.079, 1.40], [-0.053, 1.285], [0.012, 1.27], [0.056, 1.32], [0.061, collarY - 0.031]], 0.0038, 0.002), "trim", "torso", "fixed", 0x293a3e);
      add("top", garmentButton(surface, 0.013, 1.273, 0.012), "trim", "torso", "fixed", 0xa9b3b5);
    }
  } else if (style === "nursing" || style === "dress") {
    const neck = [[-0.059, collarY - 0.011], [0, collarY - 0.073], [0.059, collarY - 0.011]] as const;
    add("top", surfaceSeam(surface, neck, 0.0018), "collar", "torso", "primary_shade", 0xd7ddd9);
    pocket(-0.068, 1.355, 0.05, 0.052); badge(-0.069, 1.372);
    if (style === "nursing") for (const side of [-1, 1]) pocket(side * 0.067, waist + 0.065, 0.057, 0.064);
    else {
      placket();
      add("top", ringTrim(base, waist + 0.020), "seam", "torso", "primary_shade", 0xd0cec5);
    }
  } else if (style === "formal") {
    foldedCollar(); placket(); pocket(-0.069, 1.345, 0.054, 0.06);
  } else if (style === "native") {
    add("top", surfaceSeam(surface, [[-0.048, collarY], [0, collarY - 0.013], [0.048, collarY]], 0.0023), "collar", "torso", "primary_shade", 0xc9bd9c);
    placket(); pocket(-0.065, 1.33, 0.05, 0.065);
  } else if (style === "agric") {
    add("top", surfacePatch(surface, 0, waist + 0.20, body === "f" ? 0.175 : 0.205, 0.235, 0.002), "trim", "torso", "fixed", 0x7a5232);
    for (const side of [-1, 1]) {
      const x = side * 0.067;
      add("top", surfacePatch(surface, x, 1.412, 0.022, 0.16, 0.004), "trim", "torso", "fixed", 0x7a5232);
      add("top", garmentButton(surface, x, 1.334, 0.0045), "button", "torso", "fixed", 0xc3ae81);
    }
    pocket(0, waist + 0.22, 0.094, 0.076, "fixed");
  } else if (style === "sports") {
    for (const side of [-1, 1]) add("top", surfacePatch(surface, side * 0.094, 1.294, 0.010, 0.20), "trim", "torso", "fixed", 0xe8e6db);
    add("top", surfaceSeam(surface, [[-0.056, collarY - 0.01], [0, collarY - 0.052], [0.056, collarY - 0.01]], 0.0015), "collar", "torso", "fixed", 0xe8e6db);
  }
  topShell.dispose();
  if (style === "dress") {
    const skin = skinLegs(sources.bottom, sources.joints), visibleSkin = clipGarment(skin, (point) => 0.607 - point.y); skin.dispose();
    add("bottom", visibleSkin, "skin", "legs", "skin", 0x82553a);
    const skirtTop = trouserSurface.bounds.max.y - 0.008, hipY = skirtTop - 0.09;
    const ring = base.ring(skirtTop, 64, 0.0015), hip = lowerEnvelope(trouserSurface, hipY);
    const rings = Array.from({ length: 14 }, (_, row) => {
      const y = THREE.MathUtils.lerp(skirtTop, 0.59, row / 13), fit = THREE.MathUtils.smoothstep(skirtTop - y, 0, skirtTop - hipY), flare = THREE.MathUtils.smoothstep(hipY - y, 0, hipY - 0.59) * 0.16;
      return ring.map((hit, i) => {
        const point = hit.point.clone().lerp(hip[i], fit); point.y = y;
        point.x *= 1 + flare; point.z = 0.065 + (point.z - 0.065) * (1 + flare * 0.65);
        const legMotion = THREE.MathUtils.smoothstep(skirtTop - y, 0.02, skirtTop - hipY + 0.07);
        return { ...hit, point, influences: normalizedInfluences([...hit.influences.map(({ joint, weight }) => ({ joint, weight: weight * (1 - fit) })), ...drapeBinding(point, sources.joints, legMotion).map(({ joint, weight }) => ({ joint, weight: weight * fit }))]) };
      });
    });
    const skirt = fittedLoft(rings), skirtSurface = new GarmentSurface(skirt);
    add("bottom", skirt, "shell", "skirt");
    add("bottom", ringTrim(skirtSurface, 0.594), "seam", "skirt", "primary_shade", 0xd0cec5);
    add("bottom", ringTrim(skirtSurface, skirtTop - 0.006), "seam", "skirt", "primary_shade", 0xd0cec5);
  } else if (style === "sports") {
    const cutoff = body === "f" ? 0.77 : 0.72;
    add("bottom", clipGarment(sources.bottom, (point) => point.y - cutoff), "shell", "legs");
    const skin = skinLegs(sources.bottom, sources.joints), exposed = clipGarment(skin, (point) => cutoff + 0.018 - point.y); skin.dispose();
    add("bottom", exposed, "skin", "legs", "skin", 0x82553a);
  } else {
    add("bottom", sources.bottom.clone(), "shell", "legs");
  }
  return pieces;
}
