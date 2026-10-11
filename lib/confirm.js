// lib/confirm.js
// Promise-based replacement for window.confirm / window.prompt. Plain module state + subscribe (same idea as lib/toast.js),
// so any client handler can `await confirmAction(...)` with no hook or context. <ConfirmDialog /> (mounted once in the root
// layout) renders whatever is asked. Requests queue up and are shown one at a time. Calls on the server resolve to "cancelled".
//
//   if (!(await confirmAction({ title: "Quit your job?", message: "You lose your job experience.", confirmLabel: "Quit", tone: "danger" }))) return;
//   const reason = await askText({ title: "Report this player", label: "What happened?", required: true, confirmLabel: "Send report" });
//   if (reason === null) return;           // cancelled
//
// Options: title, message, confirmLabel, cancelLabel, tone ("default" | "danger"),
//          ack: "I understand this can't be undone"   (a checkbox that must be ticked before the confirm button works)
//          input: { label, placeholder, required, maxLength, multiline, initial }   (turns it into a text prompt)

const EMPTY = null;
let queue = [];
let current = EMPTY;   // the request on screen, or null
let seq = 0;
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };

export const subscribe = (l) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getSnapshot = () => current;
export const getServerSnapshot = () => EMPTY;

function next() {
  current = queue.shift() ?? EMPTY;
  emit();
}

/** Used by <ConfirmDialog />: finish the request on screen. `result` is { ok, value }. */
export function settle(id, result) {
  if (!current || current.id !== id) return;
  const { resolve } = current;
  next();
  try { resolve(result); } catch { /* a bad listener must never break the queue */ }
}

/** Low level: resolves { ok, value }. Prefer confirmAction / askText below. */
export function ask(options = {}) {
  if (typeof window === "undefined") return Promise.resolve({ ok: false, value: "" });
  return new Promise((resolve) => {
    const req = { id: ++seq, tone: "default", confirmLabel: "Confirm", cancelLabel: "Cancel", ...options, resolve };
    if (current) queue.push(req); else { current = req; emit(); }
  });
}

/** Yes / no. Resolves true only if the player confirmed. */
export const confirmAction = async (options) => (await ask(options)).ok;

/** Text prompt. Resolves the trimmed text, or null if cancelled. */
export async function askText({ label = "Your answer", required = true, ...rest } = {}) {
  const r = await ask({ ...rest, input: { label, required, ...(rest.input ?? {}) } });
  return r.ok ? r.value.trim() : null;
}