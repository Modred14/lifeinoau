import type { PlannedCall } from "./species";

export const NOTE_ATTACK = 0.012;
export const NOTE_ATTACK_SHARE = 0.3;
export const NOTE_HOLD_SHARE = 0.65;
export const NOTE_HOLD_LEVEL = 0.6;
export const RELEASE_TAIL = 0.05;

export interface Voice {
  stop(): void;
}

export function playCall(ctx: BaseAudioContext, out: AudioNode, call: PlannedCall, at: number, done: () => void): Voice {
  const tone = ctx.createOscillator();
  const amp = ctx.createGain();
  const nodes: AudioNode[] = [tone, amp];
  const sources: OscillatorNode[] = [tone];
  const end = at + call.length + RELEASE_TAIL;
  tone.type = call.wave;
  amp.gain.value = 0;
  tone.connect(amp);

  let tail: AudioNode = amp;
  if (typeof ctx.createStereoPanner === "function") {
    const pan = ctx.createStereoPanner();
    pan.pan.value = call.pan;
    amp.connect(pan);
    nodes.push(pan);
    tail = pan;
  }
  tail.connect(out);

  for (const note of call.notes) {
    const start = at + note.at;
    const attack = Math.min(NOTE_ATTACK, note.length * NOTE_ATTACK_SHARE);
    tone.frequency.setValueAtTime(note.from, start);
    tone.frequency.exponentialRampToValueAtTime(note.to, start + note.length);
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(call.level, start + attack);
    amp.gain.linearRampToValueAtTime(call.level * NOTE_HOLD_LEVEL, start + Math.max(attack, note.length * NOTE_HOLD_SHARE));
    amp.gain.linearRampToValueAtTime(0, start + note.length);
  }

  if (call.vibrato) {
    const wobble = ctx.createOscillator();
    const depth = ctx.createGain();
    wobble.frequency.value = call.vibrato.rate;
    depth.gain.value = call.vibrato.depth;
    wobble.connect(depth);
    depth.connect(tone.frequency);
    nodes.push(wobble, depth);
    sources.push(wobble);
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const node of nodes) node.disconnect();
    done();
  };
  tone.onended = finish;
  for (const source of sources) {
    source.start(at);
    source.stop(end);
  }

  return {
    stop() {
      tone.onended = null;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          continue;
        }
      }
      finish();
    },
  };
}
