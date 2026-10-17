import { and, eq, gt, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { AuthError, formatRecoveryCode, normalizeRecoveryCode, normalizeUsername, passwordProblem, usernameProblem, type AccountView, type AuthErrorCode } from "@campuslife/shared/account";
import { authenticateOau } from "../oau/bridge";
import { env } from "../config/env";
import { db } from "../database/database";
import { accounts, sessions, type AccountRow } from "../database/schema";
import { ProfileStore, profiles } from "../persistence/ProfileStore";
import { accountFailures } from "./limits";
import { hashPassword, isToken, newPlayerId, newRecoveryCode, newToken, safeEqual, sha256, verifyPassword } from "./secrets";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SESSION_REFRESH_AFTER_MS = MS_PER_DAY;
const SESSION_SWEEP_EVERY_MS = 60 * 60 * 1000;
const UNIQUE_VIOLATION = "23505";
const USERNAME_CONSTRAINT = "accounts_username_unique";
const PLAYER_CONSTRAINT = "accounts_player_id_unique";
const STATUS: Record<AuthErrorCode, number> = {
  [AuthError.Invalid]: 400,
  [AuthError.UsernameTaken]: 409,
  [AuthError.UsernameReserved]: 409,
  [AuthError.WrongCredentials]: 401,
  [AuthError.WrongRecovery]: 401,
  [AuthError.TooManyAttempts]: 429,
  [AuthError.SignedOut]: 401,
  [AuthError.Unavailable]: 503,
};

export class AuthFailure extends Error {
  readonly status: number;

  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.status = STATUS[code];
  }
}

export interface SignedIn {
  token: string;
  account: AccountView;
}

export interface SignedInWithRecovery extends SignedIn {
  recoveryCode: string;
}

export interface Credentials {
  username: unknown;
  password: unknown;
}

function violatedConstraint(err: unknown): string | null {
  for (let current: unknown = err, depth = 0; typeof current === "object" && current !== null && depth < 5; depth++) {
    const { code, constraint_name: constraint, cause } = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (code === UNIQUE_VIOLATION && typeof constraint === "string") return constraint;
    current = cause;
  }
  return null;
}

function validCredentials(input: Credentials): { username: string; password: string } {
  const username = normalizeUsername(input.username);
  const problem = usernameProblem(username);
  if (problem === "reserved") throw new AuthFailure(AuthError.UsernameReserved);
  if (problem || typeof input.password !== "string" || passwordProblem(input.password, username)) throw new AuthFailure(AuthError.Invalid);
  return { username, password: input.password };
}

async function viewOf(account: Pick<AccountRow, "username" | "playerId">): Promise<AccountView> {
  const save = await profiles.load(account.playerId);
  return { username: account.username, hasSave: save !== undefined, level: save?.level };
}

async function openSession(accountId: string): Promise<string> {
  const token = newToken();
  await db.insert(sessions).values({ id: sha256(token), accountId, expiresAt: new Date(Date.now() + env.SESSION_DAYS * MS_PER_DAY) });
  return token;
}

/** The save a new account starts with: this device's old save when nobody has claimed it, otherwise a new empty one. */
async function claimablePlayerId(deviceKey: unknown): Promise<string | null> {
  const id = ProfileStore.idFor(deviceKey);
  if (!id || (await profiles.load(id)) === undefined) return null;
  const [owner] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.playerId, id)).limit(1);
  return owner ? null : id;
}

export async function register(input: Credentials & { deviceKey?: unknown }): Promise<SignedInWithRecovery> {
  const { username, password } = validCredentials(input);
  const [taken] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.username, username)).limit(1);
  if (taken) throw new AuthFailure(AuthError.UsernameTaken);

  const passwordHash = await hashPassword(password);
  const recoveryCode = newRecoveryCode();
  const base = { username, passwordHash, recoveryHash: sha256(recoveryCode) };
  const claimed = await claimablePlayerId(input.deviceKey);
  let created: AccountRow | undefined;
  for (const playerId of claimed ? [claimed, newPlayerId()] : [newPlayerId()]) {
    try {
      [created] = await db.insert(accounts).values({ ...base, id: nanoid(), playerId }).returning();
      break;
    } catch (err) {
      const constraint = violatedConstraint(err);
      if (constraint === USERNAME_CONSTRAINT) throw new AuthFailure(AuthError.UsernameTaken);
      if (constraint !== PLAYER_CONSTRAINT) throw err;
    }
  }
  if (!created) throw new AuthFailure(AuthError.Unavailable);
  return { token: await openSession(created.id), account: await viewOf(created), recoveryCode: formatRecoveryCode(recoveryCode) };
}

export async function signIn(input: Credentials): Promise<SignedIn> {
  const username = normalizeUsername(input.username);
  if (usernameProblem(username) || typeof input.password !== "string") throw new AuthFailure(AuthError.WrongCredentials);
  if (!accountFailures.allowed(username)) throw new AuthFailure(AuthError.TooManyAttempts);
  const [account] = await db.select().from(accounts).where(eq(accounts.username, username)).limit(1);
  if (!(await verifyPassword(account?.passwordHash, input.password)) || !account) {
    accountFailures.spend(username);
    throw new AuthFailure(AuthError.WrongCredentials);
  }
  return { token: await openSession(account.id), account: await viewOf(account) };
}

/** Sets a new password with the recovery code, signs every device out and hands back a new recovery code. */
export async function resetPassword(input: Credentials & { recoveryCode: unknown }): Promise<SignedInWithRecovery> {
  const username = normalizeUsername(input.username);
  if (usernameProblem(username)) throw new AuthFailure(AuthError.WrongRecovery);
  if (typeof input.password !== "string" || passwordProblem(input.password, username)) throw new AuthFailure(AuthError.Invalid);
  if (!accountFailures.allowed(username)) throw new AuthFailure(AuthError.TooManyAttempts);
  const code = normalizeRecoveryCode(input.recoveryCode);
  const [account] = await db.select().from(accounts).where(eq(accounts.username, username)).limit(1);
  if (!account || !code || !safeEqual(account.recoveryHash, sha256(code))) {
    accountFailures.spend(username);
    throw new AuthFailure(AuthError.WrongRecovery);
  }
  const passwordHash = await hashPassword(input.password);
  const recoveryCode = newRecoveryCode();
  await db.transaction(async (tx) => {
    await tx.update(accounts).set({ passwordHash, recoveryHash: sha256(recoveryCode), passwordChangedAt: new Date() }).where(eq(accounts.id, account.id));
    await tx.delete(sessions).where(eq(sessions.accountId, account.id));
  });
  return { token: await openSession(account.id), account: await viewOf(account), recoveryCode: formatRecoveryCode(recoveryCode) };
}

export async function authenticate(token: unknown): Promise<AccountRow> {
  if (env.OAU_ONLY) {
    try { return await authenticateOau(token); }
    catch { throw new AuthFailure(AuthError.SignedOut); }
  }
  if (!isToken(token)) throw new AuthFailure(AuthError.SignedOut);
  const id = sha256(token);
  const now = new Date();
  const [found] = await db
    .select({ account: accounts, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!found) throw new AuthFailure(AuthError.SignedOut);
  if (now.getTime() - found.lastUsedAt.getTime() > SESSION_REFRESH_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + env.SESSION_DAYS * MS_PER_DAY) })
      .where(eq(sessions.id, id));
  }
  return found.account;
}

export async function currentAccount(token: unknown): Promise<AccountView> {
  return viewOf(await authenticate(token));
}

export async function signOut(token: unknown) {
  if (isToken(token)) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export function sweepExpiredSessions() {
  const sweep = () =>
    db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .catch((err: unknown) => console.error("[auth] could not clear expired sessions", err));
  void sweep();
  setInterval(sweep, SESSION_SWEEP_EVERY_MS).unref();
}
