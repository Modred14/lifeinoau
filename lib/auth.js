// lib/auth.js
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { PrismaClient } from "@prisma/client";
import { checkAccount } from "./accountGate.js";

const COOKIE = "oau";
const DAY = 86400;
const REMEMBER_DAYS = 30; // "keep me logged in": persistent cookie
const SHORT_DAYS = 1;     // not remembered: browser-session cookie (gone when the browser closes), token valid for a day at most
const REFRESH_AFTER = DAY; // sliding session: re-issue the cookie when it is older than this

const key = () => new TextEncoder().encode(process.env.SESSION_SECRET); // 32+ random chars
const cookieOpts = (remember) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", ...(remember ? { maxAge: REMEMBER_DAYS * DAY } : {}) });

export const hash = (pw) => bcrypt.hash(pw, 12);
export const check = (pw, h) => bcrypt.compare(pw, h);

/** Log the user in. `remember` (default true) keeps them logged in on this device for 30 days; false ends the session when the browser closes. */
export async function startSession(userId, remember = true) {
  const t = await new SignJWT({ sub: userId, rem: !!remember }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${remember ? REMEMBER_DAYS : SHORT_DAYS}d`).sign(key());
  (await cookies()).set(COOKIE, t, cookieOpts(remember));
}

/** { userId, remember, stale } for a valid session cookie, otherwise null. `stale` means it is time to re-issue it. */
export async function readSession() {
  const t = (await cookies()).get(COOKIE)?.value; if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, key());
    if (!payload.sub) return null;
    return { userId: payload.sub, remember: payload.rem !== false, stale: !payload.iat || Date.now() / 1000 - payload.iat > REFRESH_AFTER };
  } catch { return null; }
}

const gateDb = () => (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } })); // the same shared client every route uses

/** The signed-in user's id, or null. A suspended or deleted account counts as signed out on EVERY route that asks (lib/accountGate.js), so a ban takes effect everywhere at once. */
export async function getUserId() {
  const s = await readSession();
  if (!s) return null;
  return (await checkAccount(gateDb(), s.userId)).ok ? s.userId : null;
}

/** Log out: remove the cookie. */
export async function endSession() { (await cookies()).set(COOKIE, "", { ...cookieOpts(true), maxAge: 0 }); }