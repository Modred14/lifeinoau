import { cookies } from "next/headers";

export const noStore = { "Cache-Control": "no-store" };
export function sameOrigin(request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  try { return new URL(request.headers.get("origin")).host === new URL(request.url).host; }
  catch { return false; }
}
export async function campusRequest(request, path, body) {
  const secret = process.env.AUTH_PROXY_SECRET;
  if (!secret) throw new Error("Campus connection is not configured.");
  const token = (await cookies()).get("oau")?.value;
  const headers = { "content-type": "application/json", "x-auth-proxy-secret": secret, "x-auth-client-ip": request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "" };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${process.env.GAME_SERVER_INTERNAL_URL || "http://localhost:2567"}${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15000) });
}
