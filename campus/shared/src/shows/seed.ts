const RANGE = 4294967296;
const GOLDEN = 0x9e3779b9;
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;

export type Rand = () => number;

function mix(n: number): number {
  let h = (n ^ GOLDEN) >>> 0;
  h = Math.imul(h ^ (h >>> 16), MIX_A);
  h = Math.imul(h ^ (h >>> 13), MIX_B);
  return (h ^ (h >>> 16)) >>> 0;
}

export function seeded(n: number): Rand {
  let s = mix(n | 0);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / RANGE;
  };
}

export function pick<T>(rand: Rand, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

export function between(rand: Rand, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}
