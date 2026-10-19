// lib/roomGate.js
// The room can only be read once the player's home exists on the server. Choosing a hostel is shown instantly (the game screen opens at once),
// but the server only creates the home, and the furniture that comes with it, when the choice request finishes. If the room were asked for
// in between, the server would answer "Choose where to live first" and the room would stay empty until a page reload.
//
// Anything that changes where the player lives wraps its request in holdRoomUntil(); the room store waits at waitForRoomGate() before it
// asks for the room. No timers and no guessing: the room is requested the moment the request that creates it has finished (success or not).
// Pure module (no browser or React APIs), so Node tests can check it.
const pending = new Set();

/** Remember `promise` (a request that creates or changes the player's home). Returns it unchanged, so it can wrap the request in place. */
export function holdRoomUntil(promise) {
  const p = Promise.resolve(promise);
  const settled = p.then(() => {}, () => {});
  pending.add(settled);
  settled.then(() => pending.delete(settled));
  return promise;
}

/** Resolves when every request registered with holdRoomUntil() has finished (immediately when there are none). */
export async function waitForRoomGate() {
  while (pending.size) await Promise.all([...pending]);
}

/** True while such a request is still running. */
export const roomGateOpen = () => pending.size > 0;
