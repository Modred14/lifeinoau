import type { Layer } from "./beds";

export const GENERATOR_PITCH = 52;
export const GENERATOR_HARMONICS: readonly number[] = [1, 2, 3.02];
export const GENERATOR_CUTOFF = 420;
export const GENERATOR_CHUG_RATE = 13;
export const GENERATOR_CHUG_DEPTH = 0.35;
export const GENERATOR_LEVEL = 0.11;
export const GENERATOR_REACH_M = 45;

export function generatorLevel(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM >= GENERATOR_REACH_M) return 0;
  const near = 1 - Math.max(0, distanceM) / GENERATOR_REACH_M;
  return near * near;
}

export function createGenerator(ctx: BaseAudioContext, out: AudioNode): Layer {
  const tone = ctx.createBiquadFilter();
  const chug = ctx.createGain();
  const level = ctx.createGain();
  tone.type = "lowpass";
  tone.frequency.value = GENERATOR_CUTOFF;
  chug.gain.value = 1 - GENERATOR_CHUG_DEPTH;
  level.gain.value = 0;

  const engines = GENERATOR_HARMONICS.map((multiple, i) => {
    const osc = ctx.createOscillator();
    const part = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = GENERATOR_PITCH * multiple;
    part.gain.value = 1 / (i + 1.5);
    osc.connect(part);
    part.connect(tone);
    osc.start();
    return { osc, part };
  });
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = GENERATOR_CHUG_RATE;
  depth.gain.value = GENERATOR_CHUG_DEPTH;
  lfo.connect(depth);
  depth.connect(chug.gain);
  lfo.start();

  tone.connect(chug);
  chug.connect(level);
  level.connect(out);

  return {
    level: level.gain,
    dispose() {
      for (const source of [...engines.map((e) => e.osc), lfo]) {
        try {
          source.stop();
        } catch {
          continue;
        }
      }
      for (const node of [...engines.flatMap((e) => [e.osc, e.part]), lfo, depth, tone, chug, level]) node.disconnect();
    },
  };
}
