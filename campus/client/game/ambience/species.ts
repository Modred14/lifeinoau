export type Range = readonly [number, number];
export type Wave = "sine" | "triangle";
export type Random = () => number;

export interface Vibrato {
  rate: number;
  depth: number;
}

export interface VoiceSpec {
  name: string;
  weight: number;
  wave: Wave;
  level: number;
  notes: Range;
  pitch: Range;
  scatter: Range;
  drift: Range;
  glide: Range;
  length: Range;
  gap: Range;
  vibrato?: Vibrato;
}

export interface PlannedNote {
  at: number;
  length: number;
  from: number;
  to: number;
}

export interface PlannedCall {
  voice: string;
  wave: Wave;
  level: number;
  pan: number;
  length: number;
  notes: PlannedNote[];
  vibrato?: Vibrato;
}

export const PITCH_FLOOR = 180;
export const PITCH_CEILING = 6800;
export const PAN_SPREAD = 0.85;
export const DISTANCE_LEVEL: Range = [0.35, 1];

export const BIRD_VOICES: readonly VoiceSpec[] = [
  { name: "bulbul", weight: 5, wave: "sine", level: 0.2, notes: [3, 6], pitch: [1900, 2700], scatter: [0.78, 1.3], drift: [0.97, 1.04], glide: [0.82, 1.22], length: [0.07, 0.14], gap: [0.03, 0.09] },
  { name: "dove", weight: 3, wave: "sine", level: 0.24, notes: [3, 5], pitch: [470, 610], scatter: [0.97, 1.03], drift: [0.94, 0.99], glide: [0.9, 0.97], length: [0.2, 0.36], gap: [0.12, 0.26], vibrato: { rate: 22, depth: 9 } },
  { name: "weaver", weight: 4, wave: "triangle", level: 0.1, notes: [8, 16], pitch: [3000, 4300], scatter: [0.8, 1.22], drift: [0.99, 1.01], glide: [0.86, 1.1], length: [0.025, 0.05], gap: [0.018, 0.045] },
  { name: "sunbird", weight: 3, wave: "sine", level: 0.09, notes: [1, 3], pitch: [5300, 6400], scatter: [0.96, 1.04], drift: [0.97, 1.02], glide: [0.8, 0.9], length: [0.06, 0.12], gap: [0.07, 0.16] },
  { name: "robin-chat", weight: 3, wave: "sine", level: 0.17, notes: [2, 5], pitch: [1400, 2300], scatter: [0.75, 1.34], drift: [0.98, 1.02], glide: [0.94, 1.07], length: [0.18, 0.34], gap: [0.05, 0.12], vibrato: { rate: 9, depth: 18 } },
];

export const NIGHT_VOICES: readonly VoiceSpec[] = [
  { name: "frog", weight: 3, wave: "triangle", level: 0.16, notes: [2, 5], pitch: [520, 720], scatter: [0.97, 1.03], drift: [0.99, 1.01], glide: [1.04, 1.16], length: [0.06, 0.1], gap: [0.09, 0.16] },
  { name: "nightjar", weight: 2, wave: "sine", level: 0.13, notes: [3, 7], pitch: [1500, 1900], scatter: [0.99, 1.01], drift: [0.995, 1.005], glide: [0.9, 0.96], length: [0.08, 0.13], gap: [0.1, 0.15], vibrato: { rate: 30, depth: 40 } },
];

const between = (range: Range, random: Random) => range[0] + (range[1] - range[0]) * random();
const clampPitch = (hz: number) => Math.min(PITCH_CEILING, Math.max(PITCH_FLOOR, hz));

export function pickVoice(voices: readonly VoiceSpec[], random: Random): VoiceSpec {
  const total = voices.reduce((sum, voice) => sum + voice.weight, 0);
  let mark = random() * total;
  for (const voice of voices) {
    mark -= voice.weight;
    if (mark < 0) return voice;
  }
  return voices[voices.length - 1];
}

export function planCall(spec: VoiceSpec, random: Random): PlannedCall {
  const count = Math.round(between(spec.notes, random));
  const base = between(spec.pitch, random);
  const drift = between(spec.drift, random);
  const notes: PlannedNote[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const from = clampPitch(base * drift ** i * between(spec.scatter, random));
    const length = between(spec.length, random);
    notes.push({ at, length, from, to: clampPitch(from * between(spec.glide, random)) });
    at += length + between(spec.gap, random);
  }
  const last = notes[notes.length - 1];
  return {
    voice: spec.name,
    wave: spec.wave,
    level: spec.level * between(DISTANCE_LEVEL, random),
    pan: (random() * 2 - 1) * PAN_SPREAD,
    length: last.at + last.length,
    notes,
    vibrato: spec.vibrato,
  };
}

export const planBirdCall = (random: Random) => planCall(pickVoice(BIRD_VOICES, random), random);
export const planNightCall = (random: Random) => planCall(pickVoice(NIGHT_VOICES, random), random);
