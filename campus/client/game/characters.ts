/**
 * 3D characters: load the compressed modular parts, assemble one character
 * from four outfits (head / top / bottom / shoes) on a single skeleton,
 * recolour it from the player's look, and drive its animations.
 *
 * Asset files come from web/scripts/build-characters.mts. Every outfit of a
 * body type shares one skeleton, so parts can be mixed freely and a single
 * set of animation clips drives them all.
 */
import * as THREE from "three";
import { StudentFace } from "./student-face";
import { assembleAvatar, type AssembledAvatar } from "./avatar/assembly";
import { acquireLookAssets, prefetchLookAssets, type LookAssets } from "./avatar/assets";
import { ActivityPose } from "./avatar/activity-pose";
import { poseKey, type Pose, type PoseDetail } from "./avatar/pose-detail";
import { PoseProps } from "./avatar/pose-props";
import { SeatedPose } from "./avatar/seated-pose";
import { decodeLook, type AnimationName, type Look } from "@campuslife/shared/avatar";

/** Start downloading what a look needs (e.g. while the creator is open). */
export function prefetchLook(look: Look) {
  prefetchLookAssets(look);
}

export type { Pose, PoseDetail };

export class Character {
  /** Set by the view: whether character meshes cast real-time shadows. */
  static castShadows = false;
  static groundAt?: (x: number, z: number) => number;
  /** Add this to the scene; its position is the feet, rotation.y the facing. */
  readonly root = new THREE.Group();
  look: Look;
  private model?: THREE.Object3D;
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<AnimationName, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private emoteAction?: THREE.AnimationAction;
  private loadToken = 0;
  private disposed = false;
  private loading = false;
  private loadError?: Error;
  private loadTask: Promise<void>;
  private face?: StudentFace;
  private assembled?: AssembledAvatar;
  private seatedPose?: SeatedPose;
  private activityPose?: ActivityPose;
  private props?: PoseProps;
  private pose: Pose = "stand";
  private detail?: PoseDetail;
  private poseId = "stand";
  private thighPitch = 0;
  private lift = 0;
  private feet = new THREE.Vector3();
  private poseTime = Math.random() * 10;

  constructor(lookString: string) {
    this.look = decodeLook(lookString);
    this.loadTask = this.load();
  }

  get ready() {
    return !!this.model;
  }

  get status(): "loading" | "ready" | "error" {
    return this.loadError ? "error" : this.loading ? "loading" : "ready";
  }

  async whenReady() {
    let task: Promise<void>;
    do {
      task = this.loadTask;
      await task;
    } while (task !== this.loadTask && !this.disposed);
    if (this.disposed || !this.model && !this.loadError) throw new Error("Character is unavailable");
    if (this.loadError) throw this.loadError;
  }

  lookAt(point: THREE.Vector3) {
    this.face?.lookAt(point);
  }

  /** Switch outfit (rebuilds the model, keeps position). */
  setLook(lookString: string) {
    if (this.disposed) return;
    const next = decodeLook(lookString);
    if (JSON.stringify(next) === JSON.stringify(this.look) && !this.loadError && (this.model || this.loading)) return;
    this.look = next;
    this.loadTask = this.load();
  }

  private async load() {
    const token = ++this.loadToken;
    this.loading = true;
    this.loadError = undefined;
    const look = this.look;
    let sources: LookAssets | undefined;
    let assembled: AssembledAvatar;
    try {
      sources = await acquireLookAssets(look);
      if (token !== this.loadToken || this.disposed) {
        sources.release();
        return;
      }
      assembled = assembleAvatar(sources, look, Character.castShadows);
    } catch (err) {
      sources?.release();
      if (token === this.loadToken && !this.disposed) {
        this.loading = false;
        this.loadError = err instanceof Error ? err : new Error("Character load failed");
        console.warn("[Campus Life] character load failed", err);
      }
      return;
    }
    const { model: base, face, bones } = assembled;
    // Swap in the new model.
    this.disposeModel();
    this.assembled = assembled;
    this.model = base;
    this.face = face;
    this.seatedPose = new SeatedPose(base, bones);
    this.activityPose = new ActivityPose(base, bones, look.body);
    this.loading = false;
    this.root.add(base);
    this.mixer = new THREE.AnimationMixer(base);
    this.actions.clear();
    for (const clip of sources.animations.animations) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name as AnimationName, action);
    }
    for (const name of ["Wave", "Interact"] as const) {
      const a = this.actions.get(name);
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = false;
      }
    }
    this.mixer.addEventListener("finished", (e) => {
      if (e.action === this.emoteAction) this.emoteAction = undefined;
    });
    this.current = undefined;
    this.emoteAction = undefined;
    this.play("Idle");
    const pose = this.pose;
    this.pose = "stand";
    this.poseId = "stand";
    this.setPose(pose, this.detail);
  }

  /** Sit / lie down / loop a busy animation, or stand normally. */
  setPose(pose: Pose, detail?: PoseDetail) {
    const id = poseKey(pose, detail);
    if (id === this.poseId) return;
    if (this.pose === "sit") this.seatedPose?.restore();
    this.activityPose?.release();
    this.props?.dispose();
    this.props = undefined;
    this.pose = pose;
    this.detail = detail;
    this.poseId = id;
    this.thighPitch = 0;
    this.emoteAction = undefined;
    const interact = this.actions.get("Interact");
    if (interact) {
      interact.setLoop(pose === "busy" ? THREE.LoopRepeat : THREE.LoopOnce, pose === "busy" ? Infinity : 1);
      interact.timeScale = pose === "busy" ? 0.7 : 1;
    }
    if (this.model) {
      // Feet are the origin: lower the body onto a seat, or lay it on its back.
      const m = this.model;
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      const fit = pose === "sit" && detail?.seat ? this.activityPose?.seatFit(detail.seat) : undefined;
      if (fit) {
        m.position.set(0, fit.y, fit.z);
        this.thighPitch = fit.thighPitch;
      } else if (pose === "sit") m.position.set(0, -0.47 * (this.look.body === "f" ? 0.95 : 1), -0.12);
      if (pose === "lie") {
        m.rotation.x = -Math.PI / 2;
        m.position.set(0, 0.62, 0.86);
      }
    }
    this.play(pose === "busy" ? "Interact" : pose === "dance" ? "Run" : "Idle");
    const run = this.actions.get("Run");
    if (run) run.timeScale = pose === "dance" ? 0.55 : 1;
    if (detail && (pose === "sit" || pose === "eat")) {
      this.props = new PoseProps(detail, pose === "sit");
      this.root.add(this.props.group);
    }
  }

  private settle(dt: number) {
    let ground = 0;
    if (Character.groundAt && this.root.parent) {
      this.root.getWorldPosition(this.feet);
      ground = Character.groundAt(this.feet.x, this.feet.z) - (this.feet.y - this.root.position.y);
    }
    if (ground === this.lift) return;
    const next = Math.abs(ground - this.lift) < 0.002 ? ground : this.lift + (ground - this.lift) * Math.min(1, dt * 14);
    this.root.position.y += next - this.lift;
    this.lift = next;
  }

  private play(name: AnimationName, fade = 0.2) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  /** Play a one-shot emote (stops when the player starts moving). */
  playEmote(name: AnimationName) {
    const a = this.actions.get(name);
    if (!a) return;
    this.emoteAction = a;
    this.current?.fadeOut(0.15);
    a.reset().setEffectiveWeight(1).fadeIn(0.15).play();
    this.current = a;
  }

  /** Advance animation. `speed` is ground speed in metres/second. */
  update(dt: number, speed: number) {
    this.settle(dt);
    if (!this.mixer) return;
    this.face?.update(dt);
    this.activityPose?.release();
    if (this.pose !== "stand") {
      this.mixer.update(dt);
      if (this.pose === "dance" && this.model) {
        // Bounce and sway to the beat (~120 bpm).
        this.poseTime += dt;
        this.model.rotation.y = Math.sin(this.poseTime * 2.1) * 0.6;
        this.model.position.y = Math.abs(Math.sin(this.poseTime * 6.3)) * 0.06;
      }
      if (this.pose === "sit") {
        this.seatedPose?.apply(this.thighPitch);
      }
      if (this.detail && this.activityPose && (this.pose === "sit" || this.pose === "eat")) {
        this.activityPose.apply(dt, this.pose === "sit", this.detail);
        this.props?.update(this.activityPose);
      }
      return;
    }
    if (this.emoteAction && speed > 0.3) this.emoteAction = undefined;
    if (!this.emoteAction) {
      if (speed < 0.3) this.play("Idle");
      else if (speed < 3) {
        this.play("Walk");
        this.actions.get("Walk")!.timeScale = Math.max(0.6, speed / 1.6);
      } else {
        this.play("Run");
        this.actions.get("Run")!.timeScale = Math.max(0.7, speed / 5.5);
      }
    }
    this.mixer.update(dt);
  }

  private disposeModel() {
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.assembled?.dispose();
    this.assembled = undefined;
    this.model = undefined;
    this.mixer = undefined;
    this.face = undefined;
    this.seatedPose = undefined;
    this.activityPose = undefined;
    this.props?.dispose();
    this.props = undefined;
    this.actions.clear();
    this.current = undefined;
    this.emoteAction = undefined;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken++;
    this.loading = false;
    this.disposeModel();
    this.root.removeFromParent();
  }
}
