import { AuthError, type AccountView, type AuthErrorCode } from "@campuslife/shared/account";
import { STORAGE_KEYS } from "@campus/lib/storage";

export interface NewAccount extends AccountView {
  recoveryCode: string;
}

type Action = "register" | "sign-in" | "reset" | "session" | "ticket" | "sign-out";

const AUTH_MESSAGES: Record<AuthErrorCode, string> = {
  [AuthError.Invalid]: "Check the username and password and try again.",
  [AuthError.UsernameTaken]: "That username is taken. Try another one.",
  [AuthError.UsernameReserved]: "That username isn't available. Try another one.",
  [AuthError.WrongCredentials]: "Wrong username or password.",
  [AuthError.WrongRecovery]: "That username and recovery code don't match.",
  [AuthError.TooManyAttempts]: "Too many attempts. Wait a few minutes and try again.",
  [AuthError.SignedOut]: "Sign in to continue.",
  [AuthError.Unavailable]: "We couldn't reach the campus server. Try again shortly.",
};
const KNOWN_CODES = new Set<string>(Object.values(AuthError));

export class AuthRequestError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(AUTH_MESSAGES[code]);
  }
}

export function authErrorMessage(err: unknown): string {
  return err instanceof AuthRequestError ? err.message : AUTH_MESSAGES[AuthError.Unavailable];
}

async function call<T>(action: Action, body: object = {}): Promise<T> {
  let res: Response;
  let data: unknown;
  try {
    res = await fetch(`/api/campus/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch {
    throw new AuthRequestError(AuthError.Unavailable);
  }
  if (!res.ok) {
    const code = typeof data === "object" && data !== null ? (data as { error?: unknown }).error : undefined;
    throw new AuthRequestError(typeof code === "string" && KNOWN_CODES.has(code) ? (code as AuthErrorCode) : AuthError.Unavailable);
  }
  return data as T;
}

function readStored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(username: string) {
  try {
    localStorage.setItem(STORAGE_KEYS.username, username);
  } catch {
    /* storage unavailable */
  }
}

export function lastUsername(): string {
  return readStored(STORAGE_KEYS.username) ?? "";
}

/** True when this device has progress from before accounts existed. Creating an account here keeps it. */
export function hasDeviceSave(): boolean {
  return readStored(STORAGE_KEYS.deviceKey) !== undefined;
}

export async function fetchAccount(): Promise<AccountView | null> {
  try {
    return await call<AccountView>("session");
  } catch (err) {
    if (err instanceof AuthRequestError && err.code === AuthError.SignedOut) return null;
    throw err;
  }
}

export async function createAccount(username: string, password: string): Promise<NewAccount> {
  const account = await call<NewAccount>("register", { username, password, deviceKey: readStored(STORAGE_KEYS.deviceKey) });
  remember(account.username);
  try {
    localStorage.removeItem(STORAGE_KEYS.deviceKey);
  } catch {
    /* storage unavailable */
  }
  return account;
}

export async function signIn(username: string, password: string): Promise<AccountView> {
  const account = await call<AccountView>("sign-in", { username, password });
  remember(account.username);
  return account;
}

export async function resetPassword(username: string, recoveryCode: string, password: string): Promise<NewAccount> {
  const account = await call<NewAccount>("reset", { username, recoveryCode, password });
  remember(account.username);
  return account;
}

export async function signOut(): Promise<void> {
  await call<{ ok: boolean }>("sign-out");
}

export async function requestTicket(): Promise<string> {
  return (await call<{ ticket: string }>("ticket")).ticket;
}
