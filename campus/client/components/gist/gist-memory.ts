import { STORAGE_KEYS } from "../../lib/storage";

interface GistMemory {
  joins: number;
  seen: string[];
}

const MAX_SEEN = 64;
const EMPTY: GistMemory = { joins: 0, seen: [] };

let cached: GistMemory | undefined;

function read(): GistMemory {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.gist);
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (typeof data === "object" && data !== null) {
      const from = data as Partial<GistMemory>;
      cached = {
        joins: typeof from.joins === "number" && Number.isFinite(from.joins) ? Math.max(0, Math.floor(from.joins)) : 0,
        seen: Array.isArray(from.seen) ? from.seen.filter((s): s is string => typeof s === "string").slice(-MAX_SEEN) : [],
      };
      return cached;
    }
  } catch {
    cached = undefined;
  }
  cached = { ...EMPTY, seen: [] };
  return cached;
}

function write(next: GistMemory) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEYS.gist, JSON.stringify(next));
  } catch {
    cached = next;
  }
}

export function countJoin(): number {
  const memory = read();
  const joins = memory.joins + 1;
  write({ ...memory, joins });
  return joins;
}

export const hasSeen = (key: string): boolean => read().seen.includes(key);

export function markSeen(key: string) {
  const memory = read();
  if (memory.seen.includes(key)) return;
  write({ ...memory, seen: [...memory.seen, key].slice(-MAX_SEEN) });
}
