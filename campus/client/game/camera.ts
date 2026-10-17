import * as THREE from "three";

export interface CameraLimits {
  pitchMin: number;
  pitchMax: number;
  zoomMin: number;
  zoomMax: number;
  panMax: number;
}

export interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CameraPose {
  yaw: number;
  pitch: number;
  zoom: number;
}

const deg = THREE.MathUtils.degToRad;

export const OUTDOOR_LIMITS: CameraLimits = { pitchMin: deg(4), pitchMax: deg(88), zoomMin: 4, zoomMax: 700, panMax: 4000 };
export const INDOOR_LIMITS: CameraLimits = { pitchMin: deg(28), pitchMax: deg(80), zoomMin: 5, zoomMax: 16, panMax: 8 };

const ORBIT_SMOOTHING = 14;
const ZOOM_SMOOTHING = 7;
const PAN_SMOOTHING = 12;
const SPIN_FRICTION = 5;
const DRIFT_FRICTION = 4.5;
const SPIN_REST = 0.02;
const DRIFT_REST = 0.05;
const LOOK_HEIGHT = 1;
const LOOK_UP_BELOW = deg(30);
const LOOK_UP_RATIO = 0.22;
const MIN_CAMERA_HEIGHT = 0.7;
const MIN_PAN_FORESHORTEN = 0.3;
const FREE_THRESHOLD = 0.5;

export class CameraRig {
  yaw = 0;
  pitch = deg(55);
  zoom = 14;
  viewYaw = 0;
  readonly focus = new THREE.Vector3();
  private viewPitch = this.pitch;
  private viewZoom = this.zoom;
  private pan = new THREE.Vector3();
  private viewPan = new THREE.Vector3();
  private spin = new THREE.Vector2();
  private drift = new THREE.Vector3();
  private limits = OUTDOOR_LIMITS;
  private bounds?: CameraBounds;

  setLimits(limits: CameraLimits) {
    this.limits = limits;
    this.halt();
    this.clamp();
  }

  setBounds(bounds: CameraBounds) {
    this.bounds = bounds;
  }

  get free() {
    return this.pan.lengthSq() > FREE_THRESHOLD * FREE_THRESHOLD;
  }

  get distance() {
    return this.viewZoom;
  }

  get pose(): CameraPose {
    return { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom };
  }

  apply(pose: Partial<CameraPose>) {
    if (pose.yaw !== undefined) this.yaw = pose.yaw;
    if (pose.pitch !== undefined) this.pitch = pose.pitch;
    if (pose.zoom !== undefined) this.zoom = pose.zoom;
    this.clamp();
  }

  orbit(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch += dPitch;
    this.clamp();
  }

  zoomBy(factor: number) {
    this.zoom *= factor;
    this.clamp();
  }

  panPixels(dx: number, dy: number, viewportHeight: number, fovDeg: number) {
    const m = this.pixelsToMetres(dx, dy, viewportHeight, fovDeg);
    this.panMetres(m.right, m.forward);
  }

  panMetres(right: number, forward: number) {
    this.pan.add(this.toWorld(right, forward));
    this.clamp();
  }

  fling(yawPerSecond: number, pitchPerSecond: number) {
    this.spin.set(yawPerSecond, pitchPerSecond);
  }

  flingPixels(vx: number, vy: number, viewportHeight: number, fovDeg: number) {
    const m = this.pixelsToMetres(vx, vy, viewportHeight, fovDeg);
    this.drift.copy(this.toWorld(m.right, m.forward));
  }

  halt() {
    this.spin.set(0, 0);
    this.drift.set(0, 0, 0);
  }

  recenter() {
    this.drift.set(0, 0, 0);
    this.pan.set(0, 0, 0);
  }

  reset() {
    this.halt();
    this.yaw = 0;
    this.recenter();
  }

  snap() {
    this.halt();
    this.clamp();
    this.viewYaw = this.yaw;
    this.viewPitch = this.pitch;
    this.viewZoom = this.zoom;
    this.viewPan.copy(this.pan);
  }

  update(dt: number, follow: THREE.Vector3, camera: THREE.PerspectiveCamera) {
    this.coast(dt);
    this.keepInBounds(follow);

    const k = 1 - Math.exp(-dt * ORBIT_SMOOTHING);
    this.viewYaw += Math.atan2(Math.sin(this.yaw - this.viewYaw), Math.cos(this.yaw - this.viewYaw)) * k;
    this.viewPitch += (this.pitch - this.viewPitch) * k;
    this.viewZoom *= Math.pow(this.zoom / this.viewZoom, 1 - Math.exp(-dt * ZOOM_SMOOTHING));
    this.viewPan.lerp(this.pan, 1 - Math.exp(-dt * PAN_SMOOTHING));
    this.focus.copy(follow).add(this.viewPan);

    const t = this.focus;
    const horizontal = this.viewZoom * Math.cos(this.viewPitch);
    const lookUp = THREE.MathUtils.clamp((LOOK_UP_BELOW - this.viewPitch) / LOOK_UP_BELOW, 0, 1);
    camera.position.set(
      t.x - horizontal * Math.sin(this.viewYaw),
      t.y + Math.max(MIN_CAMERA_HEIGHT, LOOK_HEIGHT + this.viewZoom * Math.sin(this.viewPitch)),
      t.z + horizontal * Math.cos(this.viewYaw),
    );
    camera.lookAt(t.x, t.y + LOOK_HEIGHT + lookUp * this.viewZoom * LOOK_UP_RATIO, t.z);
  }

  private coast(dt: number) {
    if (this.spin.lengthSq() > 0) {
      this.yaw += this.spin.x * dt;
      this.pitch += this.spin.y * dt;
      this.spin.multiplyScalar(Math.exp(-dt * SPIN_FRICTION));
      if (this.spin.lengthSq() < SPIN_REST * SPIN_REST) this.spin.set(0, 0);
    }
    if (this.drift.lengthSq() > 0) {
      this.pan.addScaledVector(this.drift, dt);
      this.drift.multiplyScalar(Math.exp(-dt * DRIFT_FRICTION));
      if (this.drift.lengthSq() < DRIFT_REST * DRIFT_REST) this.drift.set(0, 0, 0);
    }
    this.clamp();
  }

  private keepInBounds(follow: THREE.Vector3) {
    const b = this.bounds;
    if (!b || follow.x < b.minX || follow.x > b.maxX || follow.z < b.minZ || follow.z > b.maxZ) return;
    this.pan.x = THREE.MathUtils.clamp(follow.x + this.pan.x, b.minX, b.maxX) - follow.x;
    this.pan.z = THREE.MathUtils.clamp(follow.z + this.pan.z, b.minZ, b.maxZ) - follow.z;
  }

  private pixelsToMetres(dx: number, dy: number, viewportHeight: number, fovDeg: number) {
    const perPixel = (2 * this.viewZoom * Math.tan(deg(fovDeg) / 2)) / Math.max(1, viewportHeight);
    return { right: -dx * perPixel, forward: (dy * perPixel) / Math.max(MIN_PAN_FORESHORTEN, Math.sin(this.viewPitch)) };
  }

  private toWorld(right: number, forward: number) {
    const c = Math.cos(this.viewYaw);
    const s = Math.sin(this.viewYaw);
    return new THREE.Vector3(right * c + forward * s, 0, right * s - forward * c);
  }

  private clamp() {
    const l = this.limits;
    if (this.pitch <= l.pitchMin || this.pitch >= l.pitchMax) this.spin.y = 0;
    this.pitch = THREE.MathUtils.clamp(this.pitch, l.pitchMin, l.pitchMax);
    this.zoom = THREE.MathUtils.clamp(this.zoom, l.zoomMin, l.zoomMax);
    this.pan.clampLength(0, l.panMax);
  }
}
