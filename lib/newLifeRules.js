// lib/newLifeRules.js
// "Start a new life": the rules, with no database and no browser, so the server enforces exactly what the Settings dialog tells the player.
// What a new life resets, what it never touches, and what has to be finished first.

/** The server refuses to reset anything unless the request carries this exact token. The Settings dialog only sends it after the player ticked the box and typed their password. */
export const NEW_LIFE_CONFIRM = "START_NEW_LIFE";

/** What disappears (shown in the confirmation dialog). */
export const NEW_LIFE_LOSES = [
  "Your character: name, look, class, faculty, level, stats and progress",
  "All your cash, investments and businesses",
  "Your home, furniture, cars and the clothes you bought",
  "Courses, exam results, jobs, awards and achievements",
  "Your relationships, chats, blocked players and notifications",
  "Your game history: bets, casino rounds and club spending",
];

/** What stays exactly as it is (shown in the confirmation dialog). */
export const NEW_LIFE_KEEPS = [
  "Your account: email and password",
  "Your settings: audio, gameplay, notifications and privacy",
  "Anything you paid real money for, such as billboard posters",
  "Student election history and moderation records",
];

const at = (d) => (d == null ? 0 : +new Date(d));

/** Why this player cannot start a new life right now: a list of sentences (empty = they can).
 *  `f` = the facts the server reads from the database. Nobody can use a new life to walk away from a punishment, a wager or an office they hold. */
export function newLifeBlockers(f = {}, now = Date.now()) {
  const out = [];
  if (at(f.jailedUntil) > now) out.push("You are in Floor O (N-QRS Custody). Serve your sentence or pay bail first.");
  if (at(f.suspendedUntil) > now) out.push("You are suspended. Wait for the suspension to end.");
  if (f.expelled && (f.expelledUntil == null || at(f.expelledUntil) > now)) out.push("You have been expelled. Wait for the expulsion to end.");
  if ((f.matches ?? 0) > 0 || (f.seated ?? 0) > 0 || (f.queued ?? 0) > 0) out.push("You have a Games match, challenge or search running. Finish or leave it first.");
  if ((f.openBets ?? 0) > 0) out.push("You have bets that are still open. Wait for them to settle.");
  if ((f.flyingRounds ?? 0) > 0) out.push("You have a casino round in progress.");
  if ((f.sugCandidacies ?? 0) > 0) out.push("You are a candidate in the running Students' Union election.");
  if ((f.sugOffices ?? 0) > 0) out.push("You hold a Students' Union office. Serve out your term first.");
  if ((f.buyouts ?? 0) > 0) out.push("You are hosting a club buyout that is still running.");
  return out;
}
