import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { RECOVERY_CODE_ALPHABET, RECOVERY_CODE_GROUPS, RECOVERY_CODE_GROUP_LENGTH } from "@campuslife/shared/account";

const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const DECOY_PASSWORD = "campuslife-decoy-password";

let decoyHash: Promise<string> | undefined;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function newPlayerId(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function newRecoveryCode(): string {
  let code = "";
  for (let i = 0; i < RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH; i++) code += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)];
  return code;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Checks a password. With no stored hash it still does the same work, so a missing account takes as long as a wrong password. */
export async function verifyPassword(stored: string | undefined, password: string): Promise<boolean> {
  if (stored === undefined) {
    decoyHash ??= hashPassword(DECOY_PASSWORD);
    await verify(await decoyHash, password);
    return false;
  }
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
