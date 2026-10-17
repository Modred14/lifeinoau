/**
 * Colyseus Schema definitions for synced room state.
 *
 * Shared so the client decodes with the exact same classes the server encodes
 * (typed state, no runtime reflection). Only data every client must see
 * belongs here; server-only data (input intent, sub-pixel positions, rate
 * limiters) stays on the server.
 *
 * Bandwidth note: positions are uint16 (2 bytes each) rather than float64.
 * The server keeps exact float positions privately and syncs rounded ones.
 * Colyseus only sends fields that changed, so idle players cost ~0 bytes.
 */
import { schema, t, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema(
  {
    id: t.string(),
    name: t.string(),
    // uint16: the real campus is ~47,000 x 27,000 map px (2.4 km x 1.3 km at 20 px/m);
    // building interiors sit in slots below it (see interiors.ts), still < 65,536.
    x: t.uint16(),
    y: t.uint16(),
    /** 0..7 facing, see Direction in movement.ts */
    dir: t.uint8(),
    /** Outfit + colours, encoded by encodeLook() in avatar.ts (validated server-side). */
    look: t.string(),
    /** Current emote id (index into EMOTES). */
    emote: t.uint8(),
    /** Bumped every time an emote starts, so clients replay the same emote twice in a row. */
    emoteSeq: t.uint8(),
    /** Current activity (index into ACTS in interiors.ts), 0 = none. */
    act: t.uint8(),
    /** SPOTS index + 1 of the seat/counter in use, 0 = none. */
    spot: t.uint16(),
    /** Vehicle index + 1 while riding the shuttle/bus, 0 = on foot. */
    ride: t.uint8(),
    // Needs, 0..100 (only the owner shows them, but they're tiny and rarely change).
    food: t.uint8(),
    energy: t.uint8(),
    fun: t.uint8(),
    /** Naira in pocket. */
    cash: t.uint32(),
    /** Study points earned in lectures / libraries. */
    study: t.uint16(),
    /** Family background, index into BACKGROUNDS (life.ts). */
    bg: t.uint8(),
    // Skills 0..100 (life.ts SKILLS).
    drive: t.uint8(),
    cook: t.uint8(),
    teach: t.uint8(),
    /** Outstanding loan (₦). */
    debt: t.uint32(),
    /** Vehicle index + 1 while driving a shuttle shift, 0 = not driving. */
    driving: t.uint8(),
    /** Queue id + 1 while standing in a queue (queues.ts), 0 = not queueing. */
    queue: t.uint16(),
    /** Delivered food packs you're carrying (eat them anywhere). */
    packs: t.uint8(),
    /** On duty as a delivery rider. */
    rider: t.boolean(),
    /** Lectures attended. */
    attended: t.uint16(),
    /** CGPA x 100 (e.g. 412 = 4.12), exams written, last grade, malpractice cases. */
    cgpa: t.uint16(),
    exams: t.uint8(),
    lastGrade: t.string(),
    malpractice: t.uint8(),
    /** Game minute your rustication ends (0 = not rusticated). */
    rusticatedUntil: t.uint32(),
    /** Prep for the next test: study points and lectures since the last one. */
    weekStudy: t.uint16(),
    weekAttended: t.uint8(),
    phone: t.string(),
    office: t.uint8(),
    status: t.uint8(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** A campus shuttle or bus, simulated by the server along a real-road loop. */
export const VehicleState = schema(
  {
    /** Index into LINES (transit.ts), 255 for student-driven shuttles. */
    line: t.uint8(),
    x: t.uint16(),
    y: t.uint16(),
    /** Heading, angleToByte() of atan2(dy, dx). */
    rot: t.uint8(),
    /** Stop index while waiting at a stop, 255 while driving. */
    stop: t.uint8(),
    /** Index of the next stop. */
    next: t.uint8(),
    riders: t.uint8(),
    /** 0 = shuttle, 1 = bus (VEHICLE_KINDS). */
    kind: t.uint8(),
    /** sessionId of the student driving it ("" = campus-run, or an idle driver slot). */
    driver: t.string(),
    /** False for idle student-driver slots (hidden). */
    active: t.boolean(),
  },
  "VehicleState",
);
export type VehicleState = SchemaType<typeof VehicleState>;

/** A queue's simulated students: bit i set = slot i holds an NPC (players are synced as players). */
export const QueueState = schema({ mask: t.uint16() }, "QueueState");
export type QueueState = SchemaType<typeof QueueState>;

/** A food delivery order (see ORDER statuses in life.ts). */
export const OrderState = schema(
  {
    customer: t.string(),
    /** SPOTS index of the vendor (an "eat" counter or stall). */
    spot: t.uint16(),
    status: t.uint8(),
    /** sessionId of the student rider who took it ("" = none / campus rider). */
    rider: t.string(),
  },
  "OrderState",
);
export type OrderState = SchemaType<typeof OrderState>;

export const CampusState = schema(
  {
    players: t.map(PlayerState),
    vehicles: t.array(VehicleState),
    /** Same order as QUEUES in queues.ts. */
    queues: t.array(QueueState),
    /** Food delivery orders by id. */
    orders: t.map(OrderState),
    /** Students online across ALL campus room instances (refreshed every few seconds). */
    online: t.uint16(),
    /** Campus clock: game minutes since the epoch (clock.ts). */
    clock: t.uint32(),
  },
  "CampusState",
);
export type CampusState = SchemaType<typeof CampusState>;
