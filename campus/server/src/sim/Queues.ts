/**
 * Live queues. Each entry is a player's sessionId or a simulated student
 * ("npc"). Simulated students arrive over time (more at busy places), wait
 * their turn, get served / board, and leave — so queues feel alive even when
 * few players are online.
 */
import { QUEUES } from "@campuslife/shared";

export const NPC = "npc";

export interface LiveQueue {
  entries: string[];
  /** Seconds left serving the NPC at the head of a counter queue. */
  serving: number;
}

export function createQueues(): LiveQueue[] {
  return QUEUES.map((q) => ({
    // Start with a few people already waiting at busy stops.
    entries: Array.from({ length: q.kind === "stop" ? (q.busy ? 3 : 1) : 0 }, () => NPC),
    serving: 0,
  }));
}

/** Simulated arrivals per second and caps. */
function arrival(qi: number): { rate: number; max: number } {
  const q = QUEUES[qi];
  if (q.kind === "stop") return q.busy ? { rate: 0.12, max: 6 } : { rate: 0.04, max: 3 };
  return { rate: 0.015, max: 2 };
}

/** NPCs join the back of the line now and then. */
export function npcArrivals(queues: LiveQueue[], dt: number) {
  queues.forEach((lq, i) => {
    const { rate, max } = arrival(i);
    const npcs = lq.entries.filter((e) => e === NPC).length;
    if (npcs >= max || lq.entries.length >= QUEUES[i].slots.length) return;
    if (Math.random() < rate * dt) lq.entries.push(NPC);
  });
}

/** Bitmask of slots holding NPCs (for syncing). */
export function npcMask(lq: LiveQueue): number {
  let m = 0;
  lq.entries.forEach((e, i) => {
    if (e === NPC) m |= 1 << i;
  });
  return m;
}
