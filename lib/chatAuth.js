// lib/chatAuth.js
// The login cookie is httpOnly and belongs to the website's address, so the browser cannot hand it to the separate realtime server.
// Instead the website gives a signed player a short-lived chat pass (a signed token) that the realtime server can check with the
// same SESSION_SECRET. The key is derived (":chat-v1"), so a chat pass can never be used as a login cookie, or the other way round.
// The website also tells the realtime server about things it did (money sent, a block) with a signed request body (HMAC).
import { SignJWT, jwtVerify } from "jose";
import { createHmac, timingSafeEqual } from "node:crypto";

export const CHAT_PASS_SECONDS = 2 * 60 * 60;
const key = (secret) => new TextEncoder().encode(`${secret}:chat-v1`);

export const signChatPass = (secret, { id, name }) =>
  new SignJWT({ cid: id, name }).setProtectedHeader({ alg: "HS256" }).setIssuer("oau-chat").setIssuedAt().setExpirationTime(`${CHAT_PASS_SECONDS}s`).sign(key(secret));

/** { id, name } of the player the pass was issued to. Throws if it is forged, expired or not a chat pass. */
export async function verifyChatPass(secret, token) {
  const { payload } = await jwtVerify(String(token ?? ""), key(secret), { issuer: "oau-chat" });
  if (typeof payload.cid !== "string" || typeof payload.name !== "string") throw new Error("bad pass");
  return { id: payload.cid, name: payload.name };
}

export const signBody = (secret, body) => createHmac("sha256", `${secret}:hook-v1`).update(body).digest("hex");
export function bodyIsSigned(secret, body, sig) {
  const a = Buffer.from(signBody(secret, body)), b = Buffer.from(String(sig ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}