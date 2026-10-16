// lib/client.js
import { toast } from "@/lib/toast";
import { resetAll } from "@/lib/optimistic";
import { createCaller } from "@/lib/http";

export const naira = (kobo) =>
  "₦" + (BigInt(kobo) / 100n).toLocaleString("en-NG");

const GENERIC = "Something went wrong. Please try again.";

// Timeouts, offline fast-fail, safe retries and request cancellation live in lib/http.js (so they can be tested without a browser).
// A call never throws: it resolves { ...serverAnswer, status, failed, error? }. A cancelled call resolves { failed: true, aborted: true }.
const caller = createCaller({ onAuthChange: resetAll });
/** call(path) reads; call(path, body) changes; call(path, body, { signal, timeout, retries }) cancels / tunes. */
export const call = caller.call;

/** Show a failed response as an error toast (server message if it is safe, otherwise `fallback`). */
export function notifyError(res, fallback = GENERIC) {
  if (res?.aborted) return; // the caller cancelled it on purpose: nothing went wrong
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