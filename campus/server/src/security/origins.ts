import { env } from "../config/env";

const ALLOW_ORIGIN = "Access-Control-Allow-Origin";

export function isOriginAllowed(origin: string | null): boolean {
  if (env.ALLOWED_ORIGINS.length === 0) return true;
  return origin !== null && env.ALLOWED_ORIGINS.includes(origin);
}

export function corsHeaders(headers: Headers): Record<string, string> {
  const origin = headers.get("origin");
  if (env.ALLOWED_ORIGINS.length === 0) return { [ALLOW_ORIGIN]: origin ?? "*" };
  return {
    [ALLOW_ORIGIN]: origin !== null && env.ALLOWED_ORIGINS.includes(origin) ? origin : env.ALLOWED_ORIGINS[0],
    Vary: "Origin",
  };
}
