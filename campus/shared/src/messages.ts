/**
 * Client -> server message protocol.
 *
 * The client NEVER sends its position. It only sends *intent*:
 * - a held direction (keyboard / future joystick), or
 * - a target point (tap-to-move).
 * The server turns intent into movement using the shared rules in movement.ts.
 *
 * Message names are kept short because every byte counts on mobile data.
 * Future messages (chat, interact, needs actions) get added here.
 */
export const Msg = {
  /** Held direction (keyboard / joystick), any angle. Payload: MoveDirPayload. 0,0 means "stop". */
  MoveDir: "d",
  /** Walk in a straight line toward a point. Payload: MoveToPayload. */
  MoveTo: "t",
  /** Change outfit. Payload: SetLookPayload. */
  SetLook: "l",
  /** Play an emote. Payload: EmotePayload. */
  Emote: "e",
  /** Walk into a building. Payload: EnterPayload. */
  Enter: "in",
  /** Leave the building you're in. No payload. */
  Exit: "out",
  /** Use a seat / bed / counter / ATM. Payload: UsePayload. */
  Use: "u",
  /** Stop the current activity (stand up). No payload. */
  StopAct: "x",
  /** Board a nearby shuttle/bus. Payload: BoardPayload. */
  Board: "b",
  /** Get off at the current stop. No payload. */
  Alight: "a",
  /** Start a shuttle-driving shift at the motor park. No payload. */
  StartDriving: "sd",
  /** End the driving shift. No payload. */
  StopDriving: "xd",
  /** Driving controls while on shift. Payload: DrivePayload. */
  Drive: "v",
  /** Join a queue (bus stop or food counter). Payload: QueuePayload. Leave by moving or StopAct. */
  Queue: "q",
  /** Order food for delivery. Payload: OrderPayload. */
  Order: "o",
  /** Eat one of your delivered food packs. No payload. */
  EatPack: "p",
  /** Go on / off duty as a delivery rider. Payload: RiderPayload. */
  RiderDuty: "r",
  /** Rider: take an open order. Payload: OrderIdPayload. */
  Accept: "ac",
  /** Rider: collect the order at the vendor. Payload: OrderIdPayload. */
  Pickup: "pu",
  /** Rider: hand the order to the customer. Payload: OrderIdPayload. */
  Deliver: "dv",
  /** During an exam: copy from your neighbour (risky!). No payload. */
  Cheat: "ch",
  BuyPhone: "bp",
  BuyItem: "bi",
  Hail: "h",
  HailCancel: "hx",
  Admin: "ad",
  Transport: "tc",
  Conditions: "cn",
  Politics: "po",
  Classes: "cl",
  Social: "so",
} as const;

/** Server -> client one-off messages. */
export const ServerMsg = {
  /** Short toast for this player. Payload: string. */
  Notice: "n",
  /** A campus rider just delivered to you. Payload: { x, y } (where they stand). */
  Delivered: "dl",
  Transport: "tc",
  Hail: "hs",
  Knock: "kn",
  Conditions: "cn",
  Politics: "po",
  Union: "un",
  Classes: "cl",
  Admin: "ad",
  Shop: "sr",
  Social: "so",
} as const;

export type MsgType = (typeof Msg)[keyof typeof Msg];

export interface MoveDirPayload {
  /** Direction in map space (x right, y down); any length, normalised by the server. 0,0 = stop. */
  dx: number;
  dy: number;
}

export interface MoveToPayload {
  x: number;
  y: number;
}

export interface SetLookPayload {
  /** encodeLook() string */
  look: string;
}

export interface EmotePayload {
  /** Index into EMOTES (avatar.ts) */
  id: number;
}

export interface EnterPayload {
  /** Index into PLACES. */
  place: number;
}

export interface UsePayload {
  /** Index into SPOTS (interiors.ts). */
  spot: number;
}

export interface OrderPayload {
  /** SPOTS index of the vendor. */
  spot: number;
}

export interface OrderIdPayload {
  id: string;
}

export interface RiderPayload {
  on: boolean;
}

export interface QueuePayload {
  /** Index into QUEUES (queues.ts). */
  queue: number;
}

export interface DrivePayload {
  /** Throttle -1..1 (negative = brake / reverse). */
  t: number;
  /** Steering -1..1 (positive = right). */
  s: number;
}

export interface BoardPayload {
  /** Index into state.vehicles. */
  vehicle: number;
}

export interface BuyPhonePayload {
  id: string;
}

/**
 * Error codes the server sends when it refuses a join. The first three are sent
 * by the matchmaking HTTP endpoint, so they must be valid HTTP status codes.
 */
export const JoinError = {
  SignInRequired: 401,
  OriginNotAllowed: 403,
  TooManyJoins: 429,
  TooManyConnections: 4430,
  SaveUnavailable: 4503,
} as const;

/** Close codes the server uses when it ends a session that was already playing. */
export const LeaveCode = {
  SignedInElsewhere: 4409,
} as const;

/** Options sent when joining the campus room. */
export interface JoinOptions {
  /** Short-lived, single-use ticket from the account service. It says which account is joining. */
  ticket?: string;
  /** encodeLook() string; invalid values fall back to defaults. */
  look?: string;
  /** School id (schools.ts) and level (levels.ts); invalid values are dropped. They replace the saved ones when valid. */
  school?: string;
  level?: string;
  /** Department id (departments.ts), checked against the school type. */
  department?: string;
  /** Start a new life: wipe this account's save first. */
  fresh?: boolean;
}

/**
 * Shape of a player as synced by the server (mirrors the Colyseus Schema on
 * the server). Clients use this interface to read state without importing
 * server code.
 */
export interface PlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 0..7, see Direction in movement.ts */
  dir: number;
  look: string;
  emote: number;
  emoteSeq: number;
}
