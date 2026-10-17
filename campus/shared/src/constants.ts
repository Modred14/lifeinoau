/**
 * Gameplay + networking constants shared by client and server.
 * Changing a value here changes it everywhere, so client prediction and
 * server simulation never disagree.
 */

/** Name of the main outdoor Colyseus room. Future: "hostel_room", etc. */
export const CAMPUS_ROOM = "campus";

/** Max players per campus room instance. Colyseus opens a new instance when full. */
export const MAX_CLIENTS_PER_ROOM = 100;

/** Server simulation + state patch rate (Hz). 20 Hz = one update every 50 ms. */
export const SERVER_TICK_RATE = 20;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/** Walking speed in world pixels per second (the 3D client renders 20 px = 1 m, so ~5.5 m/s). */
export const PLAYER_SPEED = 110;

/** Collision radius of a player (world pixels). */
export const PLAYER_RADIUS = 12;

/** Seconds a dropped client may take to reconnect before their avatar is removed. */
export const RECONNECT_WINDOW_SECONDS = 20;

/**
 * Input rate limit (token bucket). Clients only send input when it *changes*,
 * so honest clients stay far below this.
 */
export const INPUT_RATE_PER_SECOND = 20;
export const INPUT_BURST = 30;

/** Clients that keep spamming past the limit get disconnected after this many drops. */
export const INPUT_VIOLATIONS_BEFORE_KICK = 200;

/** How far behind real time remote players are rendered (ms) for smooth interpolation. */
export const INTERPOLATION_DELAY_MS = 100;

/** Minimum time between emotes / outfit changes per player (ms). */
export const EMOTE_COOLDOWN_MS = 1200;
export const LOOK_COOLDOWN_MS = 1000;
