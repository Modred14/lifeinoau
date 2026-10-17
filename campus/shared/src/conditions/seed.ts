const RANGE = 4294967296;
const PRIME_A = 374761393;
const PRIME_B = 668265263;
const PRIME_C = 1274126177;

export function roll(...parts: number[]): number {
  let h = 0x9e3779b9 | 0;
  for (const part of parts) {
    h = (Math.imul(h ^ (part | 0), PRIME_A) + PRIME_B) | 0;
    h = Math.imul(h ^ (h >>> 13), PRIME_C);
  }
  h ^= h >>> 16;
  h = Math.imul(h, PRIME_A);
  return ((h ^ (h >>> 15)) >>> 0) / RANGE;
}

export function rollBetween(lo: number, hi: number, ...parts: number[]): number {
  return lo + Math.floor(roll(...parts) * (hi - lo + 1));
}

export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h | 0;
}
