import type { NextRequest } from "next/server";

const DEFAULT_GAME_SERVER_URL = "http://localhost:2567";
const UPSTREAM_TIMEOUT_MS = 10_000;
const COOKIE = "campuslife_session";
const SECURE_COOKIE = `__Host-${COOKIE}`;
const PROXY_SECRET_HEADER = "x-auth-proxy-secret";
const CLIENT_IP_HEADER = "x-auth-client-ip";

export const NO_STORE = { "Cache-Control": "no-store" };

export function isSecure(request: NextRequest): boolean {
  return (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")) === "https";
}

export function sessionCookieName(request: NextRequest): string {
  return isSecure(request) ? SECURE_COOKIE : COOKIE;
}

export function sessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(sessionCookieName(request))?.value;
}

export function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return origin !== null && host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "";
}

export interface Upstream {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
}

/** Posts a JSON body to the game server as the signed-in player. Throws when the server cannot be reached. */
export async function forward(request: NextRequest, path: string, body: string, token: string | undefined): Promise<Upstream> {
  const headers = new Headers({ "content-type": "application/json", [CLIENT_IP_HEADER]: clientIp(request) });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (process.env.AUTH_PROXY_SECRET) headers.set(PROXY_SECRET_HEADER, process.env.AUTH_PROXY_SECRET);
  const base = process.env.GAME_SERVER_INTERNAL_URL || process.env.NEXT_PUBLIC_GAME_SERVER_URL || DEFAULT_GAME_SERVER_URL;
  const upstream = await fetch(`${base}${path}`, { method: "POST", headers, body: body || "{}", cache: "no-store", signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  return { status: upstream.status, ok: upstream.ok, data: (await upstream.json()) as Record<string, unknown> };
}
