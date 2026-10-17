/**
 * Networking: connect to the Colyseus game server and join the campus.
 *
 * - The server URL comes from NEXT_PUBLIC_GAME_SERVER_URL, or defaults to
 *   the page's hostname on port 2567 (so phones on the same Wi-Fi just work).
 * - The Colyseus SDK auto-reconnects after brief drops. We also keep the
 *   reconnection token in sessionStorage so a page reload within the
 *   server's ~20 s window resumes the same avatar instead of spawning a new one.
 */
import { Client, type Room } from "@colyseus/sdk";
import { CAMPUS_ROOM, CampusState, JoinError, LeaveCode, RECONNECT_WINDOW_SECONDS, type JoinOptions } from "@campuslife/shared";
import { AuthError } from "@campuslife/shared/account";
import { AuthRequestError, requestTicket } from "@campus/lib/api/auth";
import { STORAGE_KEYS } from "@campus/lib/storage";

export type CampusRoom = Room<any, CampusState>;

const SESSION_KEY = STORAGE_KEYS.session;
const LEAVE_WAIT_MS = 1500;

let queue: Promise<void> = Promise.resolve();

const JOIN_ERROR_MESSAGES: Record<number, string> = {
  [JoinError.SignInRequired]: "Sign in to continue your life on campus.",
  [LeaveCode.SignedInElsewhere]: "Your account started playing on another device, so this one left campus.",
  [JoinError.OriginNotAllowed]: "This site isn't allowed to connect to the campus server.",
  [JoinError.TooManyJoins]: "Too many people are joining from your network. Try again in a minute.",
  [JoinError.TooManyConnections]: "Too many players are already connected from your network.",
  [JoinError.SaveUnavailable]: "We couldn't load your saved progress. Try again shortly.",
};
const JOIN_ERROR_FALLBACK = "Couldn't reach the campus server. Check your connection and try again.";

export function joinErrorMessage(err: unknown): string {
  if (err instanceof AuthRequestError && err.code === AuthError.SignedOut) return JOIN_ERROR_MESSAGES[JoinError.SignInRequired];
  if (err instanceof AuthRequestError) return err.message;
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return (typeof code === "number" && JOIN_ERROR_MESSAGES[code]) || JOIN_ERROR_FALLBACK;
}

export function leaveMessage(code: number): string | undefined {
  return code === LeaveCode.SignedInElsewhere ? JOIN_ERROR_MESSAGES[code] : undefined;
}

export function gameServerUrl(): string {
  const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (configured) return configured;
  const secure = window.location.protocol === "https:";
  return `${secure ? "https" : "http"}://${window.location.hostname}:2567`;
}

interface SavedSession {
  token: string;
  name: string;
  savedAt: number;
}

function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(room: CampusRoom, name: string) {
  try {
    const s: SavedSession = { token: room.reconnectionToken, name, savedAt: Date.now() };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* private mode / storage full: reconnection-on-reload just won't work */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Join (or resume) the campus room as the signed-in account. `fresh` wipes the account's save first. */
export function joinCampus(name: string, look: string, school: string, level: string, department: string, fresh = false, cancelled: () => boolean = () => false): Promise<CampusRoom | null> {
  const mine = queue.then(async () => {
    if (cancelled()) return null;
    const room = await connect(name, look, school, level, department, fresh);
    if (!cancelled()) return room;
    await depart(room);
    return null;
  });
  queue = mine.then(
    () => undefined,
    () => undefined,
  );
  return mine;
}

export function leaveCampus(room: CampusRoom): Promise<void> {
  const left = depart(room);
  queue = Promise.all([queue, left]).then(() => undefined);
  return left;
}

function depart(room: CampusRoom): Promise<void> {
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, LEAVE_WAIT_MS));
  return Promise.race([room.leave(true), timeout]).then(
    () => undefined,
    () => undefined,
  );
}

async function connect(name: string, look: string, school: string, level: string, department: string, fresh: boolean): Promise<CampusRoom> {
  const client = new Client(gameServerUrl());

  // Resume the previous avatar after a reload, if the server still holds it.
  const saved = loadSession();
  if (saved && saved.name === name && Date.now() - saved.savedAt < RECONNECT_WINDOW_SECONDS * 1000) {
    try {
      const room = (await client.reconnect(saved.token, CampusState)) as CampusRoom;
      return configure(room, name);
    } catch {
      clearSession(); // expired; fall through to a fresh join
    }
  }

  const options: JoinOptions = { ticket: await requestTicket(), look, school, level, department, fresh };
  const room = (await client.joinOrCreate(CAMPUS_ROOM, options, CampusState)) as CampusRoom;
  return configure(room, name);
}

function configure(room: CampusRoom, name: string): CampusRoom {
  // Keep retrying for roughly the server's reconnection window.
  room.reconnection.maxRetries = 12;
  room.reconnection.minDelay = 500;
  room.reconnection.maxDelay = 2500;

  saveSession(room, name);
  room.onReconnect(() => saveSession(room, name));
  // Refresh the timestamp when the tab is hidden/closed so a reload can resume.
  const remember = () => saveSession(room, name);
  const onHide = () => {
    if (document.visibilityState === "hidden") remember();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", remember);
  room.onLeave(() => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", remember);
  });
  return room;
}
