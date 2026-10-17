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
  // 127.0.0.1, not "localhost": Node may resolve localhost to ::1, where the campus server (bound to 0.0.0.0) is not listening.
  return fetch(`${process.env.GAME_SERVER_INTERNAL_URL || "http://127.0.0.1:2567"}${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15000) });
}
/** Reads a campus response as JSON. Throws a descriptive error when something other than the campus server answered (e.g. an HTML page). */
export async function readUpstream(upstream, path) {
  const text = await upstream.text();
  try { return { status: upstream.status, data: JSON.parse(text) }; }
  catch {
    const type = upstream.headers.get("content-type") ?? "unknown";
    throw new Error(`Campus server returned non-JSON from ${upstream.url || path} (HTTP ${upstream.status}, ${type}): ${text.slice(0, 120).replace(/\s+/g, " ")}`);
  }
}