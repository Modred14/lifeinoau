import type { SoundSettings } from "@campus/lib/settings";
import { CRICKET_LEVEL, TRAFFIC_LEVEL, type Layer } from "./ambience/beds";
import { GENERATOR_LEVEL, createGenerator } from "./ambience/generator";
import { createGraph, type Graph } from "./ambience/graph";
import { birdDensity, clamp01, duckFactor, masterLevel, nightCallRate, nightLevel, planWindow } from "./ambience/plan";
import { planBirdCall, planNightCall, type PlannedCall } from "./ambience/species";
import { playCall, type Voice } from "./ambience/voices";

export { birdDensity, duckFactor, masterLevel, nightCallRate, nightLevel, planWindow } from "./ambience/plan";
export { planBirdCall, planCall, planNightCall } from "./ambience/species";

export interface AmbienceScene {
  daylight: number;
  minuteOfDay: number;
  indoors: boolean;
  traffic: number;
  generator?: number;
}

export const SCHEDULE_INTERVAL_MS = 400;
export const SCHEDULE_AHEAD = 1.2;
export const SCHEDULE_LEAD = 0.06;
export const MAX_VOICES = 8;
export const VOLUME_RAMP = 0.12;
export const DUCK_RAMP = 0.2;
export const LAYER_RAMP = 0.8;
export const SLEEP_AFTER_MS = 900;
export const UNLOCK_EVENTS = ["pointerdown", "keydown"] as const;

const START_SCENE: AmbienceScene = { daylight: 1, minuteOfDay: 720, indoors: false, traffic: 0 };
const ignore = () => undefined;
const hidden = () => typeof document !== "undefined" && document.hidden;

export class Ambience {
  private settings: SoundSettings;
  private scene: AmbienceScene = START_SCENE;
  private graph: Graph | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sleep: ReturnType<typeof setTimeout> | null = null;
  private readonly voices = new Set<Voice>();
  private birdCursor = 0;
  private nightCursor = 0;
  private chirping = false;
  private generator: Layer | null = null;
  private listening = false;
  private disposed = false;

  constructor(settings: SoundSettings) {
    this.settings = { ...settings };
    if (typeof window === "undefined" || typeof document === "undefined") return;
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlock, { passive: true });
    this.listening = true;
    document.addEventListener("visibilitychange", this.sync);
  }

  setSettings(settings: SoundSettings): void {
    this.settings = { ...settings };
    this.sync();
  }

  update(scene: AmbienceScene): void {
    this.scene = scene;
    this.mix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopListening();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.sync);
    this.stopTimer();
    this.clearSleep();
    for (const voice of [...this.voices]) voice.stop();
    this.voices.clear();
    this.generator?.dispose();
    this.generator = null;
    this.graph?.ctx.removeEventListener("statechange", this.onState);
    this.graph?.dispose();
    this.graph = null;
  }

  private readonly unlock = () => {
    if (this.disposed) return;
    if (!this.graph) {
      this.graph = createGraph();
      if (!this.graph) {
        this.stopListening();
        return;
      }
      this.graph.ctx.addEventListener("statechange", this.onState);
    }
    this.sync();
    this.onState();
  };

  private readonly onState = () => {
    if (this.graph?.ctx.state === "running") this.stopListening();
  };

  private readonly sync = () => {
    const graph = this.graph;
    if (this.disposed || !graph) return;
    this.clearSleep();
    const { ctx } = graph;
    if (this.settings.enabled && !hidden()) {
      if (ctx.state !== "running") void ctx.resume().catch(ignore);
      this.timer ??= setInterval(this.tick, SCHEDULE_INTERVAL_MS);
      this.tick();
    } else {
      this.stopTimer();
      if (hidden()) void ctx.suspend().catch(ignore);
      else this.sleep = setTimeout(() => void ctx.suspend().catch(ignore), SLEEP_AFTER_MS);
    }
    this.mix();
  };

  private mix() {
    const graph = this.graph;
    if (!graph) return;
    const now = graph.ctx.currentTime;
    const night = nightLevel(this.scene.daylight);
    graph.master.setTargetAtTime(masterLevel(this.settings), now, VOLUME_RAMP);
    graph.duck.setTargetAtTime(duckFactor(this.scene.indoors), now, DUCK_RAMP);
    graph.beds.traffic.setTargetAtTime(TRAFFIC_LEVEL * clamp01(this.scene.traffic), now, LAYER_RAMP);
    if (night > 0) this.chirping = true;
    if (this.chirping) graph.crickets().level.setTargetAtTime(CRICKET_LEVEL * night, now, LAYER_RAMP);
    const hum = clamp01(this.scene.generator ?? 0);
    if (hum > 0) this.generator ??= createGenerator(graph.ctx, graph.calls);
    this.generator?.level.setTargetAtTime(GENERATOR_LEVEL * hum, now, LAYER_RAMP);
  }

  private readonly tick = () => {
    const graph = this.graph;
    if (!graph || graph.ctx.state !== "running") return;
    const now = graph.ctx.currentTime;
    const lead = now + SCHEDULE_LEAD;
    const until = now + SCHEDULE_AHEAD;
    const birds = planWindow(Math.max(this.birdCursor, lead), until, birdDensity(this.scene.minuteOfDay, this.scene.daylight), Math.random);
    const night = planWindow(Math.max(this.nightCursor, lead), until, nightCallRate(this.scene.daylight), Math.random);
    this.birdCursor = birds.cursor;
    this.nightCursor = night.cursor;
    for (const at of birds.times) this.play(graph, planBirdCall(Math.random), at);
    for (const at of night.times) this.play(graph, planNightCall(Math.random), at);
  };

  private play(graph: Graph, call: PlannedCall, at: number) {
    if (this.voices.size >= MAX_VOICES) return;
    const voice: Voice = playCall(graph.ctx, graph.calls, call, at, () => this.voices.delete(voice));
    this.voices.add(voice);
  }

  private stopListening() {
    if (!this.listening) return;
    this.listening = false;
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock);
  }

  private stopTimer() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private clearSleep() {
    if (this.sleep === null) return;
    clearTimeout(this.sleep);
    this.sleep = null;
  }
}
