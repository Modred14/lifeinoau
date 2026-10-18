// lib/noteSeen.js
// Notes the screen has already announced some other way (for example a bet result that arrived in the answer to the request itself).
// The notification stack skips them, so one result is one toast, whichever message gets here first.
const seen = new Set();
export const markNoteSeen = (id) => { if (id != null) seen.add(String(id)); };
export const noteSeen = (id) => seen.has(String(id));