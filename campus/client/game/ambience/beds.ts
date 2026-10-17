export const NOISE_SECONDS = 4;
export const WIND_FREQUENCY = 520;
export const WIND_Q = 0.5;
export const WIND_LEVEL = 0.05;
export const WIND_GUST_RATE = 0.07;
export const WIND_GUST_DEPTH = 0.4;
export const TRAFFIC_CUTOFF = 300;
export const TRAFFIC_Q = 0.7;
export const TRAFFIC_LEVEL = 0.2;
export const CRICKET_PITCHES: readonly number[] = [4400, 4720];
export const CRICKET_PULSE_RATE = 31;
export const CRICKET_PULSE_DEPTH = 0.5;
export const CRICKET_SWELL_RATE = 0.85;
export const CRICKET_SWELL_DEPTH = 0.4;
export const CRICKET_LEVEL = 0.035;

export interface Layer {
  level: AudioParam;
  dispose(): void;
}

export interface Beds {
  traffic: AudioParam;
  dispose(): void;
}

function release(sources: AudioScheduledSourceNode[], nodes: AudioNode[]) {
  for (const source of sources) {
    try {
      source.stop();
    } catch {
      continue;
    }
  }
  for (const node of nodes) node.disconnect();
}

function wobble(ctx: BaseAudioContext, rate: number, depth: number, target: AudioParam) {
  const lfo = ctx.createOscillator();
  const amount = ctx.createGain();
  lfo.frequency.value = rate;
  amount.gain.value = depth;
  lfo.connect(amount);
  amount.connect(target);
  lfo.start();
  return { lfo, amount };
}

export function createBeds(ctx: BaseAudioContext, out: AudioNode): Beds {
  const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;

  const windBand = ctx.createBiquadFilter();
  windBand.type = "bandpass";
  windBand.frequency.value = WIND_FREQUENCY;
  windBand.Q.value = WIND_Q;
  const wind = ctx.createGain();
  wind.gain.value = WIND_LEVEL;
  const gust = wobble(ctx, WIND_GUST_RATE, WIND_LEVEL * WIND_GUST_DEPTH, wind.gain);

  const road = ctx.createBiquadFilter();
  road.type = "lowpass";
  road.frequency.value = TRAFFIC_CUTOFF;
  road.Q.value = TRAFFIC_Q;
  const traffic = ctx.createGain();
  traffic.gain.value = 0;

  noise.connect(windBand);
  windBand.connect(wind);
  wind.connect(out);
  noise.connect(road);
  road.connect(traffic);
  traffic.connect(out);
  noise.start();

  return {
    traffic: traffic.gain,
    dispose: () => release([noise, gust.lfo], [noise, windBand, wind, road, traffic, gust.lfo, gust.amount]),
  };
}

export function createCrickets(ctx: BaseAudioContext, out: AudioNode): Layer {
  const pulse = ctx.createGain();
  const swell = ctx.createGain();
  const level = ctx.createGain();
  pulse.gain.value = 1 - CRICKET_PULSE_DEPTH;
  swell.gain.value = 1 - CRICKET_SWELL_DEPTH;
  level.gain.value = 0;

  const carriers = CRICKET_PITCHES.map((pitch) => {
    const carrier = ctx.createOscillator();
    carrier.frequency.value = pitch;
    carrier.connect(pulse);
    carrier.start();
    return carrier;
  });
  const beat = wobble(ctx, CRICKET_PULSE_RATE, CRICKET_PULSE_DEPTH, pulse.gain);
  const drift = wobble(ctx, CRICKET_SWELL_RATE, CRICKET_SWELL_DEPTH, swell.gain);

  pulse.connect(swell);
  swell.connect(level);
  level.connect(out);

  return {
    level: level.gain,
    dispose: () => release([...carriers, beat.lfo, drift.lfo], [...carriers, pulse, swell, level, beat.lfo, beat.amount, drift.lfo, drift.amount]),
  };
}
