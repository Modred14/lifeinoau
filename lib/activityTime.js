// lib/activityTime.js
// How long a gameplay activity takes, in one place. Every timed activity in the game (building activities, classes, tests, the exam, study, labs,
// shop and food stops, sleep, job shifts and the two hustle runs) lasts exactly this long, on the SERVER's clock: the server writes `endsAt` from it
// when the activity starts and refuses to finish it earlier, and the screens count down to the same `endsAt`, so the two can never disagree.
//
// What this is NOT: the heartbeat of the multiplayer pings, movement updates, the 1:1 game clock, cooldowns between uses, daily limits, rides
// (keke / bus / driver), the lecture confrontation and the fight timer. Those are not "doing an activity" and keep their own numbers.
export const ACTIVITY_SECONDS = 15;
export const ACTIVITY_MS = ACTIVITY_SECONDS * 1000;
