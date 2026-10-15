// lib/sfx.js
// The game's little UI sounds, synthesized with the Web Audio API so there are no sound files to download.
// This file is pure: every recipe gets a "kit" ({ tone, noise }) tied to an audio context and an output node,
// so the same recipes play live (lib/sound.js) and can be rendered offline.
//
// Add a sound: write a recipe below, then call playSound("name") from lib/sound.js.

/** A kit bound to one audio context and one output node. */
export function makeKit(ctx, out) {
  let noiseBuf = null;
  const noiseSource = () => {
    // one second of white noise, built once and looped
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    return s;
  };

  /** A pitched blip. f = start Hz, to = end Hz (glide), at = delay (s), dur = length (s), vol = peak gain, lp = optional low-pass Hz. */
  const tone = ({ f = 440, to, type = "sine", at = 0, dur = 0.1, vol = 0.2, attack = 0.004, lp }) => {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lp;
      o.connect(filter);
      node = filter;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.03);
  };

  /** A burst of filtered noise (swooshes, clicks, thuds). from/to = filter Hz (sweeps), type = filter type. */
  const noise = ({ at = 0, dur = 0.1, vol = 0.1, from = 1000, to, q = 0.9, type = "bandpass", attack = 0.005 }) => {
    const t = ctx.currentTime + at;
    const s = noiseSource();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(filter).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur + 0.03);
  };

  return { tone, noise };
}

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, A6: 1760, E7: 2637 };

/** name -> recipe. Keep each one short (under about 0.6s) and quiet; they play on top of the music. */
export const SOUNDS = {
  // ---- taps and clicks ----
  tap: ({ tone, noise }) => {
    tone({ f: 700, to: 430, dur: 0.06, vol: 0.2 });
    noise({ dur: 0.02, vol: 0.04, from: 3500, type: "highpass" });
  },
  tick: ({ tone }) => tone({ f: 1700, to: 1500, type: "triangle", dur: 0.03, vol: 0.07 }),
  key: ({ tone }) => tone({ f: 850 + Math.random() * 300, type: "triangle", dur: 0.022, vol: 0.045 }),
  nav: ({ tone }) => {
    tone({ f: NOTE.C5, dur: 0.07, vol: 0.15 });
    tone({ f: NOTE.G5, at: 0.05, dur: 0.11, vol: 0.15 });
  },
  confirm: ({ tone }) => {
    tone({ f: 660, type: "triangle", dur: 0.08, vol: 0.17 });
    tone({ f: 990, type: "triangle", at: 0.07, dur: 0.15, vol: 0.19 });
  },
  warn: ({ tone }) => tone({ f: 300, to: 200, type: "triangle", dur: 0.15, vol: 0.2 }),
  back: ({ tone }) => tone({ f: 620, to: 400, dur: 0.08, vol: 0.17 }),
  pop: ({ tone }) => tone({ f: 480, to: 780, dur: 0.09, vol: 0.16 }),
  on: ({ tone }) => {
    tone({ f: 520, type: "triangle", dur: 0.07, vol: 0.17 });
    tone({ f: 780, type: "triangle", at: 0.065, dur: 0.13, vol: 0.18 });
  },
  off: ({ tone }) => {
    tone({ f: 780, type: "triangle", dur: 0.07, vol: 0.16 });
    tone({ f: 520, type: "triangle", at: 0.065, dur: 0.12, vol: 0.15 });
  },

  // ---- the phone ----
  open: ({ tone, noise }) => {
    noise({ dur: 0.3, vol: 0.1, from: 400, to: 3600, q: 0.8, attack: 0.09 });
    tone({ f: 330, to: 660, type: "triangle", dur: 0.22, vol: 0.12 });
    tone({ f: NOTE.B5, at: 0.17, dur: 0.14, vol: 0.09 });
  },
  close: ({ tone, noise }) => {
    tone({ f: 520, to: 260, dur: 0.15, vol: 0.17 });
    noise({ dur: 0.15, vol: 0.05, from: 2500, to: 600 });
  },
  app: ({ tone, noise }) => {
    tone({ f: 440, to: 900, dur: 0.12, vol: 0.19 });
    noise({ dur: 0.1, vol: 0.04, from: 1200, to: 4000 });
  },
  home: ({ tone }) => tone({ f: 720, to: 360, dur: 0.12, vol: 0.17 }),

  // ---- messages ----
  send: ({ tone, noise }) => {
    tone({ f: 500, to: 1000, dur: 0.14, vol: 0.16 });
    noise({ dur: 0.12, vol: 0.045, from: 1500, to: 5000 });
  },
  receive: ({ tone }) => {
    tone({ f: 740, to: 1100, dur: 0.09, vol: 0.17 });
    tone({ f: 1480, at: 0.08, dur: 0.13, vol: 0.09 });
  },
  notify: ({ tone }) => {
    tone({ f: NOTE.B5, dur: 0.18, vol: 0.14 });
    tone({ f: NOTE.E6, at: 0.11, dur: 0.32, vol: 0.14 });
  },

  // ---- results (toasts) ----
  success: ({ tone }) => {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone({ f, at: i * 0.085, dur: 0.24, vol: 0.16 }));
    tone({ f: NOTE.G6, at: 0.17, dur: 0.3, vol: 0.045 });
  },
  error: ({ tone }) => {
    tone({ f: 190, to: 130, type: "sawtooth", dur: 0.15, vol: 0.09, lp: 900 });
    tone({ f: 190, to: 120, type: "sawtooth", at: 0.18, dur: 0.2, vol: 0.09, lp: 900 });
  },
  info: ({ tone }) => {
    tone({ f: 880, dur: 0.45, vol: 0.12, attack: 0.002 });
    tone({ f: NOTE.E6, dur: 0.35, vol: 0.06, attack: 0.002 });
    tone({ f: NOTE.A6, at: 0.09, dur: 0.3, vol: 0.05, attack: 0.002 });
  },

  // ---- the game ----
  coin: ({ tone }) => {
    tone({ f: NOTE.E6, type: "square", dur: 0.1, vol: 0.1, lp: 5000 });
    tone({ f: NOTE.A6, type: "square", at: 0.07, dur: 0.38, vol: 0.1, lp: 6000 });
    tone({ f: NOTE.E7, at: 0.07, dur: 0.25, vol: 0.035 });
  },
  place: ({ tone, noise }) => {
    tone({ f: 170, to: 70, dur: 0.17, vol: 0.4 });
    noise({ dur: 0.05, vol: 0.08, from: 700, type: "lowpass" });
  },
  reel: ({ tone, noise }) => {
    tone({ f: 1250, to: 900, type: "triangle", dur: 0.035, vol: 0.1 });
    noise({ dur: 0.015, vol: 0.03, from: 3000, type: "highpass" });
  },
  // ---- the lecture brawl and the DSA ----
  punch: ({ tone, noise }) => {
    tone({ f: 150, to: 60, dur: 0.14, vol: 0.4 });
    noise({ dur: 0.07, vol: 0.18, from: 1800, to: 500 });
  },
  kick: ({ tone, noise }) => {
    tone({ f: 120, to: 45, dur: 0.2, vol: 0.5 });
    noise({ dur: 0.1, vol: 0.2, from: 1200, to: 300, type: "lowpass" });
  },
  block: ({ tone }) => {
    tone({ f: 900, to: 600, type: "square", dur: 0.05, vol: 0.08, lp: 2500 });
    tone({ f: 200, to: 120, dur: 0.08, vol: 0.18 });
  },
  whoosh: ({ noise }) => noise({ dur: 0.16, vol: 0.09, from: 600, to: 3000, q: 0.7, attack: 0.05 }),
  ko: ({ tone, noise }) => {
    tone({ f: 110, to: 35, dur: 0.5, vol: 0.55 });
    noise({ dur: 0.3, vol: 0.18, from: 900, to: 150, type: "lowpass" });
    [NOTE.E5, NOTE.C5].forEach((f, i) => tone({ f, at: 0.25 + i * 0.12, dur: 0.2, vol: 0.07, type: "triangle" }));
  },
  siren: ({ tone }) => {
    tone({ f: 640, to: 960, type: "sawtooth", dur: 0.27, vol: 0.07, lp: 2600, attack: 0.03 });
    tone({ f: 960, to: 640, type: "sawtooth", at: 0.27, dur: 0.27, vol: 0.07, lp: 2600, attack: 0.03 });
  },
  door: ({ tone, noise }) => {
    noise({ dur: 0.12, vol: 0.14, from: 500, to: 150 });
    tone({ f: 220, to: 120, type: "triangle", dur: 0.12, vol: 0.2 });
  },
  slam: ({ tone, noise }) => {
    tone({ f: 100, to: 40, dur: 0.25, vol: 0.55 });
    noise({ dur: 0.16, vol: 0.28, from: 2000, to: 200 });
  },
  engine: ({ tone }) => {
    tone({ f: 55, to: 130, type: "sawtooth", dur: 0.9, vol: 0.1, lp: 420, attack: 0.1 });
  },
  reveal: ({ tone }) => {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => tone({ f, at: i * 0.09, dur: 0.3, vol: 0.14 }));
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f) => tone({ f, at: 0.5, dur: 1.1, vol: 0.09, attack: 0.02 }));
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS);