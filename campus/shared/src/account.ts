export const USERNAME_PREFIX = "@";
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const RECOVERY_CODE_GROUPS = 5;
export const RECOVERY_CODE_GROUP_LENGTH = 4;
export const RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

const USERNAME_RE = /^[a-z0-9_]+$/;
const RECOVERY_CODE_LENGTH = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH;
const RAW_INPUT_LIMIT = 200;

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "campuslife",
  "campus_life",
  "everyone",
  "help",
  "here",
  "mod",
  "moderator",
  "null",
  "official",
  "root",
  "staff",
  "support",
  "system",
  "undefined",
]);

export const AuthError = {
  Invalid: "invalid",
  UsernameTaken: "username_taken",
  UsernameReserved: "username_reserved",
  WrongCredentials: "wrong_credentials",
  WrongRecovery: "wrong_recovery",
  TooManyAttempts: "too_many_attempts",
  SignedOut: "signed_out",
  Unavailable: "unavailable",
} as const;

export type AuthErrorCode = (typeof AuthError)[keyof typeof AuthError];

export interface AccountView {
  username: string;
  hasSave: boolean;
  level?: string;
}

export type UsernameProblem = "short" | "long" | "characters" | "reserved";
export type PasswordProblem = "short" | "long" | "username";

/** What the player has typed so far, without the leading @ and with characters we never accept dropped. */
export function cleanUsernameInput(raw: string): string {
  return raw
    .slice(0, RAW_INPUT_LIMIT)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
}

/** The stored form of a username (lower case, no @), or "" when it breaks a rule. */
export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.slice(0, RAW_INPUT_LIMIT).trim().toLowerCase();
  return value.startsWith(USERNAME_PREFIX) ? value.slice(USERNAME_PREFIX.length) : value;
}

export function usernameProblem(username: string): UsernameProblem | null {
  if (username.length < USERNAME_MIN_LENGTH) return "short";
  if (username.length > USERNAME_MAX_LENGTH) return "long";
  if (!USERNAME_RE.test(username)) return "characters";
  if (RESERVED_USERNAMES.has(username)) return "reserved";
  return null;
}

export function passwordProblem(password: string, username: string): PasswordProblem | null {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) return "short";
  if (length > PASSWORD_MAX_LENGTH) return "long";
  if (username && password.toLowerCase().includes(username)) return "username";
  return null;
}

export function formatHandle(username: string): string {
  return USERNAME_PREFIX + username;
}

/** Recovery codes are typed by hand, so accept any case and any separators. */
export function normalizeRecoveryCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw
    .slice(0, RAW_INPUT_LIMIT)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  if (value.length !== RECOVERY_CODE_LENGTH) return "";
  return Array.from(value).every((char) => RECOVERY_CODE_ALPHABET.includes(char)) ? value : "";
}

export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += RECOVERY_CODE_GROUP_LENGTH) groups.push(code.slice(i, i + RECOVERY_CODE_GROUP_LENGTH));
  return groups.join("-");
}
