/**
 * Queues: at every bus stop and every food counter / stall. People (players
 * and simulated students) stand in a line of slots; the head gets served
 * (food) or boards first (bus) — in order, like the real thing.
 *
 * Shared so the server and every client agree on where each slot is.
 */
import { PX_PER_METER, onRoad, type Point } from "./map";
import { isBlocked } from "./movement";
import { SPOTS } from "./interiors";
import { LINES } from "./transit";
import { DEFAULT_TRANSPORT, fareFor, type TransportConfig } from "./transport";

const M = PX_PER_METER;
export const QUEUE_LENGTH = 10;
const SLOT_GAP = 0.9 * M;

export interface QueueDef {
  id: number;
  kind: "stop" | "counter";
  /** Free standing positions, head first. */
  slots: Point[];
  /** Direction people face (toward the head / counter), map angle. */
  face: number;
  /** Stop queues. */
  line?: number;
  stop?: number;
  /** Counter queues: the SPOTS index being queued for. */
  spot?: number;
  /** Busy places (SUB, Main Gate) attract more simulated students. */
  busy: boolean;
}

/**
 * Slots from `head` extending in direction `dir` (map angle), skipping blocked
 * ground. With `offRoad` (bus stops), a slot that lands on the road is nudged
 * sideways (`away` angle) onto the verge, so nobody queues in traffic.
 */
function lineOfSlots(head: Point, dir: number, offRoad?: { away: number }): Point[] {
  const out: Point[] = [];
  const dx = Math.cos(dir);
  const dy = Math.sin(dir);
  for (let i = 0; out.length < QUEUE_LENGTH && i < QUEUE_LENGTH * 2; i++) {
    let x = head.x + dx * SLOT_GAP * i;
    let y = head.y + dy * SLOT_GAP * i;
    if (offRoad) {
      for (let k = 0; k < 8 && onRoad(x, y, 0.4 * M); k++) {
        x += Math.cos(offRoad.away) * 0.5 * M;
        y += Math.sin(offRoad.away) * 0.5 * M;
      }
      if (onRoad(x, y, 0.4 * M)) continue;
    }
    if (!isBlocked(x, y)) out.push({ x, y });
    else if (out.length) break; // a wall ends the line
  }
  return out;
}

function buildQueues(): QueueDef[] {
  const out: QueueDef[] = [];
  for (const line of LINES) {
    line.stops.forEach((st, k) => {
      // Stand along the kerb, the line stretching back against the traffic.
      const p = st.kerb;
      const along = Math.atan2(st.kerb.y - st.y, st.kerb.x - st.x) - Math.PI / 2; // = heading at the stop
      const slots = lineOfSlots(p, along + Math.PI, { away: along + Math.PI / 2 });
      if (slots.length < 2) return;
      out.push({ id: out.length, kind: "stop", slots, face: along, line: line.id, stop: k, busy: /student union|main gate/i.test(st.name) });
    });
  }
  SPOTS.forEach((s, i) => {
    if (s.kind !== "eat") return;
    const slots = lineOfSlots({ x: s.sx, y: s.sy }, s.face + Math.PI);
    if (slots.length < 2) return;
    out.push({ id: out.length, kind: "counter", slots, face: s.face, spot: i, busy: false });
  });
  return out;
}

export const QUEUES: readonly QueueDef[] = buildQueues();
export const queueOfSpot = new Map<number, number>();
export const queueOfStop = new Map<string, number>();
for (const q of QUEUES) {
  if (q.spot !== undefined) queueOfSpot.set(q.spot, q.id);
  if (q.line !== undefined) queueOfStop.set(`${q.line}:${q.stop}`, q.id);
}
/** Join a queue from within this distance (map px) of its head or its last person. */
export const QUEUE_JOIN_DISTANCE = 6 * M;

/** Ticket price for a campus-run line (₦) over a ride of distancePx, from the school's transport config. */
export const lineFare = (lineId: number, config: TransportConfig = DEFAULT_TRANSPORT, distancePx = 0) => fareFor(config, LINES[lineId]?.kind ?? "shuttle", distancePx);
