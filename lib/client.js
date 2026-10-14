// lib/client.js
import { toast } from "@/lib/toast";
import { resetAll } from "@/lib/optimistic";

export const naira = (kobo) =>
  "₦" + (BigInt(kobo) / 100n).toLocaleString("en-NG");

const GENERIC = "Something went wrong. Please try again.";
// Anything that smells like a stack trace, ORM message or driver error never reaches a toast.
const LEAKY =
  /prisma|sqlstate|\bP\d{4}\b|invalid `|ECONN|ENOTFOUND|node_modules|\.m?js:\d+|\bat\s+\S+\s+\(.*:\d+:\d+\)/i;
function safeError(status, error) {
  if (typeof error !== "string" || !error.trim())
    return status >= 500 ? GENERIC : undefined;
  return status >= 500 || error.length > 200 || LEAKY.test(error)
    ? GENERIC
    : error;
}

export async function call(path, body) {
  try {
    const r = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    // A different person is now (or no longer) signed in on this browser: forget every cached screen so nobody sees someone else's data.
    if (r.ok && /^\/api\/(login|signup|logout)$/.test(path)) resetAll();
    return {
      ...j,
      status: r.status,
      failed: !r.ok,
      ...(r.ok ? {} : { error: safeError(r.status, j.error) }),
    };
  } catch {
    return {
      failed: true,
      status: 0,
      error: "No connection. Check your network and try again.",
    };
  }
}

/** Show a failed response as an error toast (server message if it is safe, otherwise `fallback`). */
export function notifyError(res, fallback = GENERIC) {
  toast.error(res?.error || fallback);
}

/** A 401 from any call: say so once and send the player back to the landing page. */
export function loggedOut(router) {
  resetAll();
  toast.info("Please log in to continue.", { id: "session" });
  router.push("/");
}

/** Turn a { text, bad?, info?, sound? } outcome (the shape the game screens already build) into the right toast. */
export function say(m, o) {
  if (m?.text)
    (m.bad ? toast.error : m.info ? toast.info : toast.success)(m.text, {
      ...(m.sound ? { sound: m.sound } : {}),
      ...(m.bad ? { duration: 7000 } : {}),
      ...o,
    });
}