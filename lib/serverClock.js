// lib/serverClock.js
// The browser's own clock is never trusted. Every countdown (Floor O, suspension, expulsion, hustle cooldowns, the clock in the top bar) is shown
// against the SERVER's time: each state answer carries `serverNow`, and the difference between it and this device's clock (corrected for how long
// the request took) is remembered here. Two devices with wrong clocks therefore still show the same countdown, and changing the device clock changes nothing
// that matters: the server decides every deadline from its own clock and its own stored timestamps.
let offset = 0; // server time minus device time, ms
let synced = false;

/** Pure: the offset a reply tells us about. The server stamped `serverNow` somewhere between when we sent the request and when the reply arrived. */
export const offsetFrom = (serverNow, sentAt, receivedAt) => serverNow - (sentAt + receivedAt) / 2;

/** Remember what a reply tells us. A reply that took more than 5 seconds says too little about the offset and is ignored (after the first one). */
export function syncServerClock(serverNow, sentAt, receivedAt = Date.now()) {
  if (!Number.isFinite(serverNow) || !Number.isFinite(sentAt)) return false;
  if (synced && receivedAt - sentAt > 5000) return false;
  offset = offsetFrom(serverNow, sentAt, receivedAt);
  synced = true;
  return true;
}

/** The server's current time (ms). Falls back to the device clock until the first reply has arrived. */
export const serverTime = () => Date.now() + offset;
export const serverDate = () => new Date(serverTime());
export const clockOffset = () => offset;
/** For tests. */
export const resetServerClock = () => { offset = 0; synced = false; };