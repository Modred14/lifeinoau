import { createBeds, createCrickets, type Beds, type Layer } from "./beds";

export const TONE_CUTOFF = 7000;
export const TONE_Q = 0.5;
export const LIMITER_THRESHOLD = -14;
export const LIMITER_RATIO = 6;

type ContextCtor = typeof AudioContext;

export interface Graph {
  ctx: AudioContext;
  master: AudioParam;
  duck: AudioParam;
  calls: AudioNode;
  beds: Beds;
  crickets(): Layer;
  dispose(): void;
}

const ignore = () => undefined;

function contextCtor(): ContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope: { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor } = window;
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function createGraph(): Graph | null {
  const Ctor = contextCtor();
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  const duck = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  tone.type = "lowpass";
  tone.frequency.value = TONE_CUTOFF;
  tone.Q.value = TONE_Q;
  master.gain.value = 0;
  limiter.threshold.value = LIMITER_THRESHOLD;
  limiter.ratio.value = LIMITER_RATIO;
  duck.connect(tone);
  tone.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  const beds = createBeds(ctx, duck);
  let crickets: Layer | null = null;

  return {
    ctx,
    master: master.gain,
    duck: duck.gain,
    calls: duck,
    beds,
    crickets: () => (crickets ??= createCrickets(ctx, duck)),
    dispose() {
      beds.dispose();
      crickets?.dispose();
      for (const node of [duck, tone, master, limiter]) node.disconnect();
      void ctx.close().catch(ignore);
    },
  };
}
