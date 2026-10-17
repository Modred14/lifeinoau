/**
 * Builds the 3D campus from the shared OSM-derived map data (the same data
 * the server collides against): real building outlines extruded to height,
 * roads with kerbs, paved walkways, fields, car parks, street lamps, bus
 * stops, food stalls and place labels.
 *
 * Performance on cheap phones:
 *  - Buildings and roads are merged per ~250 m chunk / per surface, lamps are
 *    instanced, so the whole campus is a few dozen draw calls.
 *  - Small procedural canvas textures (no downloads) tiled in world space.
 *  - Instead of fading whole buildings (impossible once merged), a shader cuts
 *    a see-through hole in anything between the camera and the player.
 */
import * as THREE from "three";
import {
  AREAS,
  BUILDINGS,
  GATE,
  GATEHOUSE,
  GATE_PILLARS,
  GROUND_COLORS,
  MOTOR_PARK,
  INTERIORS,
  LINES,
  MAP_HEIGHT_PX,
  MAP_WIDTH_PX,
  PLACES,
  ROADS,
  STALLS,
  type AreaKind,
  type GameTime,
} from "@campuslife/shared";
import { buildChunkBuffers, chunkGeometry, createBuildingLook } from "./buildings";
import { toWorld } from "./coords";
import { uiFontFamily } from "./fonts";
import { disposeLabel, makeLabel } from "./labels";
import { buildScenery } from "./scenery";
import { buildBanners } from "./scenery/banners";
import { buildLamps } from "./scenery/lamps";
import { buildStalls, cullStalls } from "./scenery/stalls";
import { buildHustleProps } from "./scenery/hustle-props";

const CHUNK_M = 250;
/** Labels further than this from the view focus are hidden (metres). */
const LABEL_DISTANCE = 140;
const LABEL_DISTANCE_RATIO = 1.6;
const SMALL_LABEL_DISTANCE = 45;
const SMALL_LABEL_MAX_ZOOM = 120;
const FOG_NEAR = 110;
const FOG_FAR = 250;
const FOG_NEAR_RATIO = 1.8;
const FOG_FAR_RATIO = 4.5;
export const SKY_HORIZON = 0xd6e2e4;
const SKY_ZENITH = 0x5d9bd5;

export interface BuiltWorld {
  /** Call every frame: updates the see-through cutout and label visibility. */
  update(camera: THREE.Camera, player: THREE.Vector3 | null, focus: THREE.Vector3, distance: number): void;
  /** Push the fog back as the camera pulls away. Returns how far the camera needs to see. */
  setViewDistance(distance: number): number;
  /** Hide the campus while you're inside a building. */
  setVisible(v: boolean): void;
  /** 1 = full day, 0 = night: sky, fog, lit windows, lamp light. */
  setDaylight(k: number): void;
  setGameTime(t: GameTime): void;
  dispose(): void;
}

/** Shared uniforms for the see-through cutout. */
export const cutUniforms = {
  uPlayer: { value: new THREE.Vector3() },
  uCam: { value: new THREE.Vector3() },
  uCutRadius: { value: 0 },
};

/**
 * Patch a material so fragments between the camera and the player, inside a
 * cone around that line, are discarded (with a dithered edge).
 */
export function addCutout(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cutUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCutWorld;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef USE_INSTANCING\nvCutWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uPlayer;\nuniform vec3 uCam;\nuniform float uCutRadius;\nvarying vec3 vCutWorld;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (uCutRadius > 0.0) {
          vec3 cp = uPlayer - uCam;
          float L = length(cp);
          vec3 d = cp / L;
          vec3 cf = vCutWorld - uCam;
          float t = dot(cf, d);
          if (t > 0.0 && t < L - 0.8) {
            float r = uCutRadius * mix(0.35, 1.0, t / L);
            float dist = length(cf - d * t);
            // Dithered soft edge so the hole doesn't look like a hard circle.
            float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
            if (dist < r * (0.85 + 0.15 * dither)) discard;
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => "oau-cutout";
}

export function buildWorld(scene: THREE.Scene, opts: { shadows: boolean }): BuiltWorld {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const W = toWorld(MAP_WIDTH_PX);
  const D = toWorld(MAP_HEIGHT_PX);
  const lambert = (p: THREE.MeshLambertMaterialParameters) => track(new THREE.MeshLambertMaterial(p));

  // ---- Ground ----------------------------------------------------------------
  const grassTex = track(noiseTexture(256, [[0x6c9a48, 0.5], [0x7fa955, 0.25], [0x5d8a3d, 0.17], [0x9a9a5a, 0.08]], 0.55));
  grassTex.repeat.set((W + 800) / 14, (D + 800) / 14);
  const grass = new THREE.Mesh(track(new THREE.PlaneGeometry(W + 800, D + 800)), lambert({ map: grassTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(W / 2, 0, D / 2);
  grass.receiveShadow = opts.shadows;
  group.add(grass);

  // Areas (fields, car parks, water, plazas): one merged mesh per kind, world-space UVs.
  const areaTex: Partial<Record<AreaKind, THREE.Texture>> = {
    parking: track(noiseTexture(128, [[0x6f7176, 0.6], [0x64666b, 0.3], [0x7d7f84, 0.1]], 0.4)),
    plaza: track(paverTexture(0xb8735a, 0x965a45)),
    field: track(stripeTexture(0x4f9a48, 0x5aa652)),
  };
  const areaGeos = new Map<AreaKind, THREE.BufferGeometry[]>();
  for (const a of AREAS) {
    if (a.kind === "grass") continue;
    const shape = new THREE.Shape();
    for (let i = 0; i < a.poly.length; i += 2) {
      const x = toWorld(a.poly[i]);
      const y = -toWorld(a.poly[i + 1]); // shape Y -> world -Z after the rotation below
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    (areaGeos.get(a.kind) ?? areaGeos.set(a.kind, []).get(a.kind)!).push(g);
  }
  const areaLift: Record<string, number> = { parking: 0.015, field: 0.012, water: 0.01, plaza: 0.014 };
  const areaScale: Record<string, number> = { parking: 6, plaza: 3, field: 10 };
  for (const [kind, geos] of areaGeos) {
    const merged = track(mergeGeometries(geos, 1 / (areaScale[kind] ?? 8)));
    geos.forEach((g) => g.dispose());
    const tex = areaTex[kind];
    const mesh = new THREE.Mesh(merged, lambert(tex ? { map: tex } : { color: GROUND_COLORS[kind] }));
    mesh.position.y = areaLift[kind] ?? 0.01;
    mesh.receiveShadow = opts.shadows;
    group.add(mesh);
  }

  // Roads (asphalt over a concrete kerb strip) + paved walkways, centre dashes on bigger roads.
  const roadVerts: number[] = [];
  const kerbVerts: number[] = [];
  const pathVerts: number[] = [];
  const dashVerts: number[] = [];
  for (const r of ROADS) {
    const isRoad = r.kind === "road";
    const half = toWorld(r.width) / 2;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = toWorld(r.pts[i]), az = toWorld(r.pts[i + 1]);
      const bx = toWorld(r.pts[i + 2]), bz = toWorld(r.pts[i + 3]);
      if (isRoad) {
        pushQuadStrip(roadVerts, ax, az, bx, bz, half);
        pushDisc(roadVerts, bx, bz, half, 12);
        if (i === 0) pushDisc(roadVerts, ax, az, half, 12);
        pushQuadStrip(kerbVerts, ax, az, bx, bz, half + 1.1);
        pushDisc(kerbVerts, bx, bz, half + 1.1, 12);
        if (i === 0) pushDisc(kerbVerts, ax, az, half + 1.1, 12);
        if (half >= 2.5) {
          const len = Math.hypot(bx - ax, bz - az);
          for (let d = 1; d + 2 < len; d += 6) {
            const t0 = d / len;
            const t1 = (d + 2.4) / len;
            if (t1 > 1) break;
            pushQuadStrip(dashVerts, ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, 0.07);
          }
        }
      } else {
        pushQuadStrip(pathVerts, ax, az, bx, bz, half);
        pushDisc(pathVerts, bx, bz, half, 8);
        if (i === 0) pushDisc(pathVerts, ax, az, half, 8);
      }
    }
  }
  const asphalt = track(noiseTexture(256, [[0x4b4d51, 0.55], [0x56585c, 0.3], [0x3f4144, 0.15]], 0.35));
  const paver = track(paverTexture(0xbfa48a, 0xa08670));
  // Red laterite verges along the roads (very Ife).
  const kerbTex = track(noiseTexture(128, [[0xa6643f, 0.5], [0x93583a, 0.3], [0xb87a52, 0.2]], 0.5));
  const addFlat = (verts: number[], mat: THREE.Material, y: number, uvScale: number) => {
    if (!verts.length) return;
    const g = track(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(planarUv(verts, uvScale), 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.y = y;
    m.receiveShadow = opts.shadows;
    group.add(m);
  };
  addFlat(pathVerts, lambert({ map: paver }), 0.02, 1 / 2.4);
  addFlat(kerbVerts, lambert({ map: kerbTex }), 0.024, 1 / 3);
  addFlat(roadVerts, lambert({ map: asphalt }), 0.03, 1 / 9);
  addFlat(dashVerts, lambert({ color: 0xece8dc }), 0.036, 1);

  // ---- Buildings: merged per chunk, one material for all --------------------
  const look = track(createBuildingLook());
  const buildingMat = look.material;
  addCutout(buildingMat);
  for (const buf of buildChunkBuffers(CHUNK_M).values()) {
    const mesh = new THREE.Mesh(track(chunkGeometry(buf)), buildingMat);
    mesh.castShadow = mesh.receiveShadow = opts.shadows;
    group.add(mesh);
  }

  const instanced: THREE.InstancedMesh[] = [];
  const lamps = buildLamps({ shadows: opts.shadows });
  group.add(lamps.group);

  // ---- Bus stops: shelter + bench + sign ------------------------------------------
  const shelterRoof = lambert({ color: 0x2f6b4f });
  const shelterPost = lambert({ color: 0x8a9096 });
  const benchMat = lambert({ color: 0x7a5a3a });
  const stopLabels: THREE.Sprite[] = [];
  const seenStops = new Set<string>();
  for (const line of LINES) {
    for (const st of line.stops) {
      const key = `${Math.round(st.kerb.x / 200)},${Math.round(st.kerb.y / 200)}`;
      const angle = Math.atan2(st.kerb.y - st.y, st.kerb.x - st.x) - Math.PI / 2;
      if (seenStops.has(key)) continue; // lines sharing a stop share the shelter
      seenStops.add(key);
      const shelter = new THREE.Group();
      const roof = new THREE.Mesh(track(new THREE.BoxGeometry(3.2, 0.1, 1.5)), shelterRoof);
      roof.position.y = 2.5;
      shelter.add(roof);
      for (const sx of [-1.45, 1.45]) {
        const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 2.5, 0.08)), shelterPost);
        post.position.set(sx, 1.25, -0.6);
        shelter.add(post);
      }
      const bench = new THREE.Mesh(track(new THREE.BoxGeometry(2.4, 0.08, 0.4)), benchMat);
      bench.position.set(0, 0.45, -0.45);
      shelter.add(bench);
      const back = new THREE.Mesh(track(new THREE.BoxGeometry(3.0, 1.2, 0.04)), lambert({ color: 0xbfd8e6, transparent: true, opacity: 0.45 }));
      back.position.set(0, 1.4, -0.72);
      shelter.add(back);
      roof.castShadow = opts.shadows;
      shelter.position.set(toWorld(st.kerb.x), 0, toWorld(st.kerb.y));
      shelter.rotation.y = -angle + Math.PI;
      group.add(shelter);
      const label = makeLabel(`🚏 ${st.name.replace(/ of Residence/, "")}`, { screenHeight: 0.022, background: "rgba(47,107,79,0.92)" });
      label.position.set(toWorld(st.kerb.x), 3.2, toWorld(st.kerb.y));
      label.visible = false;
      group.add(label);
      stopLabels.push(label);
    }
  }

  const stalls = buildStalls({ shadows: opts.shadows, track, patch: addCutout });
  group.add(stalls);
  group.add(buildHustleProps({ shadows: opts.shadows, track, patch: addCutout }));
  const stallLabels: THREE.Sprite[] = [];
  STALLS.forEach((s) => {
    const label = makeLabel(s.name.split(":")[0], { screenHeight: 0.02, background: "rgba(154,52,18,0.9)" });
    label.position.set(toWorld(s.x), 3.3, toWorld(s.y));
    label.visible = false;
    group.add(label);
    stallLabels.push(label);
  });

  // ---- Main Gate: concrete arch across both carriageways of Road 1 ------------------
  if (GATE) {
    const gate = new THREE.Group();
    const concrete = lambert({ color: 0xe8e4da });
    const trim = lambert({ color: 0x2f6b4f });
    const across = GATE.span + 3 + 3.2;
    // Pillars (positions match the shared colliders).
    for (const [k, p] of GATE_PILLARS.entries()) {
      const h = k === 1 ? 11 : 8.5;
      const pillar = new THREE.Mesh(track(new THREE.BoxGeometry(3.2, h, 3.2)), concrete);
      pillar.position.set(toWorld(p.x) - toWorld(GATE.x), h / 2, toWorld(p.y) - toWorld(GATE.y));
      pillar.castShadow = pillar.receiveShadow = opts.shadows;
      gate.add(pillar);
      const cap = new THREE.Mesh(track(new THREE.BoxGeometry(3.6, 0.4, 3.6)), trim);
      cap.position.set(pillar.position.x, h + 0.2, pillar.position.z);
      gate.add(cap);
    }
    // Beam across the road (local frame: X across the road, Z along it).
    const beamGroup = new THREE.Group();
    const beam = new THREE.Mesh(track(new THREE.BoxGeometry(across, 1.6, 2.2)), concrete);
    beam.position.y = 7.6;
    beam.castShadow = opts.shadows;
    beamGroup.add(beam);
    const sign = gateSign();
    track(sign.map!);
    track(sign);
    for (const side of [-1, 1]) {
      const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(14, 1.2)), sign);
      plane.position.set(0, 7.6, side * 1.12);
      if (side < 0) plane.rotation.y = Math.PI;
      beamGroup.add(plane);
    }
    // Road direction a => across-road axis is perpendicular; three yaw for local +X along (−sin a, cos a).
    beamGroup.rotation.y = -Math.atan2(Math.cos(GATE.angle), -Math.sin(GATE.angle)) ;
    gate.add(beamGroup);
    // Gatehouse (security post) beside the outbound verge.
    if (GATEHOUSE) {
      const post = new THREE.Mesh(track(new THREE.BoxGeometry(toWorld(GATEHOUSE.halfAlong * 2), 2.8, toWorld(GATEHOUSE.halfAcross * 2))), lambert({ color: 0xd8d2c4 }));
      post.position.set(toWorld(GATEHOUSE.x) - toWorld(GATE.x), 1.4, toWorld(GATEHOUSE.y) - toWorld(GATE.y));
      post.castShadow = opts.shadows;
      gate.add(post);
    }
    gate.position.set(toWorld(GATE.x), 0, toWorld(GATE.y));
    group.add(gate);
  }

  // ---- Motor park: where students start a shuttle-driving shift ---------------------
  {
    const ring = new THREE.Mesh(track(new THREE.RingGeometry(0.9, 1.25, 32)), track(new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85, depthWrite: false })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(toWorld(MOTOR_PARK.x), 0.05, toWorld(MOTOR_PARK.y));
    group.add(ring);
    const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6)), shelterPost);
    pole.position.set(toWorld(MOTOR_PARK.x) + 1.4, 1.3, toWorld(MOTOR_PARK.y));
    group.add(pole);
    const label = makeLabel("🚐 Motor park · Drive a shuttle", { screenHeight: 0.022, background: "rgba(194,65,12,0.92)" });
    label.position.set(toWorld(MOTOR_PARK.x), 3, toWorld(MOTOR_PARK.y));
    label.visible = false;
    group.add(label);
    stopLabels.push(label);
  }

  // ---- Door markers on every building you can walk into --------------------------
  const doorIdx = PLACES.map((_, i) => i).filter((i) => INTERIORS[i]);
  if (doorIdx.length) {
    const ringGeo = track(new THREE.RingGeometry(0.55, 0.8, 28));
    ringGeo.rotateX(-Math.PI / 2);
    const doors = new THREE.InstancedMesh(ringGeo, track(new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.75, depthWrite: false })), doorIdx.length);
    const m4 = new THREE.Matrix4();
    doorIdx.forEach((i, n) => doors.setMatrixAt(n, m4.makeTranslation(toWorld(PLACES[i].door.x), 0.05, toWorld(PLACES[i].door.y))));
    doors.computeBoundingSphere();
    instanced.push(doors);
    group.add(doors);
  }

  // ---- Place labels ------------------------------------------------------------
  const labels: { sprite: THREE.Sprite; pos: THREE.Vector3; small: boolean }[] = [];
  for (const p of PLACES) {
    const h = p.building !== undefined ? BUILDINGS[p.building].height : 3;
    const sprite = makeLabel(p.name, { screenHeight: 0.03 });
    const pos = new THREE.Vector3(toWorld(p.label.x), h + 1.5, toWorld(p.label.y));
    sprite.position.copy(pos);
    sprite.visible = false;
    group.add(sprite);
    labels.push({ sprite, pos, small: false });
  }
  for (const s of [...stopLabels, ...stallLabels]) labels.push({ sprite: s, pos: s.position.clone(), small: true });

  const scenery = buildScenery({ shadows: opts.shadows, patch: addCutout });
  group.add(scenery.group);
  const banners = buildBanners({ shadows: opts.shadows, patch: addCutout });
  group.add(banners.group);

  // ---- Sky dome ------------------------------------------------------------------
  const sky = makeSky();
  track(sky.geometry);
  track(sky.material as THREE.Material);

  let daylightK = 1;
  const nightSky = new THREE.Color(0x0d1526);
  const dayFog = new THREE.Color(SKY_HORIZON);
  let fogNear = FOG_NEAR;
  let fogFar = FOG_FAR;
  const outdoor = () => {
    const c = nightSky.clone().lerp(dayFog, daylightK);
    scene.background = c;
    scene.fog = new THREE.Fog(c, fogNear, fogFar);
  };
  outdoor();
  scene.add(group, sky);
  let frame = 0;
  return {
    setViewDistance(distance) {
      fogNear = Math.max(FOG_NEAR, distance * FOG_NEAR_RATIO);
      fogFar = Math.max(FOG_FAR, distance * FOG_FAR_RATIO);
      if (group.visible && scene.fog instanceof THREE.Fog) {
        scene.fog.near = fogNear;
        scene.fog.far = fogFar;
      }
      return fogFar;
    },
    update(camera, player, focus, distance) {
      sky.position.copy(camera.position);
      if (group.visible) {
        scenery.update(focus, fogFar);
        cullStalls(stalls, focus, fogFar);
        lamps.update(focus);
        banners.update(focus, fogFar);
      }
      cutUniforms.uCam.value.copy(camera.position);
      if (player) {
        cutUniforms.uPlayer.value.set(player.x, player.y + 1.2, player.z);
        cutUniforms.uCutRadius.value = 2.4;
      } else cutUniforms.uCutRadius.value = 0;
      // Label culling a few times a second is plenty.
      if (group.visible && frame++ % 15 === 0) {
        const range = Math.max(LABEL_DISTANCE, distance * LABEL_DISTANCE_RATIO);
        const small = distance < SMALL_LABEL_MAX_ZOOM ? SMALL_LABEL_DISTANCE : 0;
        for (const l of labels) l.sprite.visible = l.pos.distanceTo(focus) < (l.small ? small : range);
      }
    },
    setVisible(v) {
      group.visible = v;
      sky.visible = v;
      if (v) outdoor();
    },
    setDaylight(k) {
      if (Math.abs(k - daylightK) < 0.004) return;
      daylightK = k;
      const night = 1 - k;
      (sky.material as THREE.MeshBasicMaterial).color.setRGB(0.12 + 0.88 * k, 0.15 + 0.85 * k, 0.28 + 0.72 * k);
      look.setNight(night);
      lamps.setNight(night);
      banners.setNight(night);
      if (group.visible) outdoor();
    },
    setGameTime(t) {
      banners.setTime(t);
      lamps.setTime(t);
    },
    dispose() {
      scene.remove(group, sky);
      scenery.dispose();
      lamps.dispose();
      banners.dispose();
      instanced.forEach((m) => m.dispose());
      labels.forEach((l) => disposeLabel(l.sprite));
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ---------------------------------------------------------------- geometry helpers

function pushQuadStrip(out: number[], ax: number, az: number, bx: number, bz: number, half: number) {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = (-(bz - az) / len) * half;
  const nz = ((bx - ax) / len) * half;
  // Two triangles facing up (+Y); counter-clockwise when seen from above.
  out.push(ax + nx, 0, az + nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
  out.push(ax + nx, 0, az + nz, bx - nx, 0, bz - nz, ax - nx, 0, az - nz);
}

function pushDisc(out: number[], cx: number, cz: number, r: number, seg: number) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    out.push(cx, 0, cz, cx + Math.cos(a1) * r, 0, cz + Math.sin(a1) * r, cx + Math.cos(a0) * r, 0, cz + Math.sin(a0) * r);
  }
}

/** World-space (top-down) UVs for flat geometry. */
function planarUv(verts: number[], scale: number): number[] {
  const uv: number[] = [];
  for (let i = 0; i < verts.length; i += 3) uv.push(verts[i] * scale, verts[i + 2] * scale);
  return uv;
}

/** Minimal geometry merge (positions only) with top-down UVs. */
function mergeGeometries(geos: THREE.BufferGeometry[], uvScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(planarUv(pos, uvScale), 2));
  out.computeVertexNormals();
  return out;
}

// ---------------------------------------------------------------- procedural textures

function canvasTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Deterministic pseudo-random for textures (same look every load). */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

/** Speckled noise in a few colours: grass, asphalt, concrete. */
function noiseTexture(size: number, palette: [number, number][], blotch: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rand = rng(size * 31 + palette[0][0]);
  g.fillStyle = hex(palette[0][0]);
  g.fillRect(0, 0, size, size);
  // Soft blotches (tiling: draw wrapped copies).
  for (let i = 0; i < 40 * blotch; i++) {
    const [col] = palette[1 + Math.floor(rand() * (palette.length - 1))];
    const x = rand() * size;
    const y = rand() * size;
    const r = (0.08 + rand() * 0.2) * size;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, hex(col) + "88");
        grad.addColorStop(1, hex(col) + "00");
        g.fillStyle = grad;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
  }
  // Fine grain.
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c);
}

/** Interlocking paving stones (very common on Nigerian campuses). */
function paverTexture(a: number, b: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const rand = rng(a);
  g.fillStyle = hex(b);
  g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * 32 + (row % 2) * 16;
      const shade = 0.9 + rand() * 0.2;
      const base = new THREE.Color(a).multiplyScalar(shade);
      g.fillStyle = `#${base.getHexString()}`;
      g.fillRect(x + 1, row * 16 + 1, 30, 14);
    }
  }
  return canvasTex(c);
}

/** Mown-grass stripes for sports fields. */
function stripeTexture(a: number, b: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = hex(a);
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = hex(b);
  g.fillRect(0, 0, 32, 64);
  return canvasTex(c);
}

/** "MAIN GATE" lettering for the arch (plain text, no university crest or logo). */
function gateSign(): THREE.MeshBasicMaterial {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 88;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f6b4f";
  g.fillRect(0, 0, 1024, 88);
  g.fillStyle = "#f6d55c";
  g.font = `800 56px ${uiFontFamily()}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("WELCOME · MAIN GATE", 512, 47);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}

/** Big gradient sphere that follows the camera. */
function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(240, 24, 12);
  const zen = new THREE.Color(SKY_ZENITH);
  const hor = new THREE.Color(SKY_HORIZON);
  const cols: number[] = [];
  const p = geo.getAttribute("position");
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getY(i) / 240);
    c.copy(hor).lerp(zen, Math.pow(t, 0.6));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
