// lib/auth.js
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET); // 32+ random chars
export const hash = (pw) => bcrypt.hash(pw, 12);
export const check = (pw, h) => bcrypt.compare(pw, h);
export async function startSession(userId) {
  const t = await new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(key());
  (await cookies()).set("oau", t, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 604800 });
}
export async function getUserId() {
  const t = (await cookies()).get("oau")?.value; if (!t) return null;
  try { return (await jwtVerify(t, key())).payload.sub; } catch { return null; }
}
