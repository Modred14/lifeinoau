import { env } from "../config/env";
import { ipKey } from "../security/ipLimits";
import { safeEqual } from "../auth/secrets";

export const AUTH_PROXY_SECRET_HEADER = "x-auth-proxy-secret";
export const AUTH_CLIENT_IP_HEADER = "x-auth-client-ip";

const BEARER = "Bearer ";
const NO_STORE = { "Cache-Control": "no-store" };
const FORWARDED_HEADERS = ["x-real-ip", "x-forwarded-for"];

export function reply(body: object, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function clientIp(headers: Headers): string {
  if (env.AUTH_PROXY_SECRET) return ipKey(headers.get(AUTH_CLIENT_IP_HEADER) ?? undefined);
  for (const name of FORWARDED_HEADERS) {
    const first = headers.get(name)?.split(",")[0];
    if (first?.trim()) return ipKey(first);
  }
  return ipKey(undefined);
}

export function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  return header?.startsWith(BEARER) ? header.slice(BEARER.length) : undefined;
}

/** False when the server expects the web app's proxy secret and the request does not carry it. */
export function fromProxy(request: Request): boolean {
  const secret = env.AUTH_PROXY_SECRET;
  return !secret || safeEqual(secret, request.headers.get(AUTH_PROXY_SECRET_HEADER) ?? "");
}
