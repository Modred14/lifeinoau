# Campus population (the number in the header)

The header shows the number of people who have visited today as an icon and a figure only (no words), e.g. **6,248**; its tooltip and screen-reader label read **6,248 people visited today**. It is a **simulation**: part of it is made up on purpose, and it must stay separate from everything real.

## How the number is made

```
people who visited today  =  5,000  +  registered accounts  +  today's simulated arrivals
```

| Part | Where it comes from | Notes |
|---|---|---|
| 5,000 | `BASE_POPULATION` in `lib/campusPopulation.js` | The simulated baseline. |
| Registered accounts | `COUNT(*)` of `User` where `status <> 'DELETED'` (`registeredAccounts`, cached 30 s) | Real. Counted **once**. Players who are online/active are **not** added again: each of them is already a registered account. |
| Today's arrivals | `CampusArrivalDay.arrivals` for today's date | Simulated. Grows by a random whole number **11 to 22 (inclusive)** per counted entry. |

"Today" is the calendar day in the game's time zone (`GAME_TIME_ZONE`, West Africa Time, `Africa/Lagos`, from `lib/campus-clock.js`). A new day is simply a new `CampusArrivalDay` row, so the reset needs no job and a restart cannot lose or repeat it.

## What counts as a game entry

A **genuine entry** is a signed-in player **with a character** starting a visit to the game, and it is counted **at most once per player per 30 minutes** (`ENTRY_COOLDOWN_MS`; override with `CAMPUS_ENTRY_COOLDOWN_MIN`, 1 to 1440).

* The browser reports a visit once per tab session (`components/CampusEntry.js`, `createEntryReporter`): a refresh or moving between pages reports nothing.
* That is only a courtesy. **The server decides**, in `recordEntry` (`lib/campusPopulationService.js`), no matter what the browser sends: refreshes, retries, reconnects, second tabs and repeated API calls inside the cool-down add nothing.
* The random number is drawn **on the server** (`lib/rng.js`, the OS secure generator). The browser sends no number and is never trusted for one.
* Entry is claimed and the arrival added in **one transaction** with two atomic statements: `INSERT ... ON CONFLICT DO UPDATE ... WHERE lastEntryAt <= cutoff` (claims the entry; Postgres row-locks the player), then `INSERT ... ON CONFLICT (day) DO UPDATE SET arrivals = arrivals + n` (a database-side increment, not read-then-write). Two different players at the same moment both keep their numbers; if the second statement fails, the first is rolled back.

## How the header updates

* `POST /api/population` (once per visit) -> the server counts the entry and answers with the new total. If it counted, it tells the realtime server (`pingRealtime({ type: "population" })`).
* The realtime server (`realtime/server.js`) pushes `pop` to every connected player, **at most once a second**, and never lets an older total replace a newer one.
* `GET /api/population` is used on load, after every reconnect, and every 2 minutes (the only update path when `REALTIME_URL` is not set).
* The browser shows nothing until the server has answered (no guess, no 0). The API returns only `{ people, at }`, never the parts.

## Database

Migration `20261120120000_campus_population` (additive): `CampusArrivalDay(day, arrivals, entries, updatedAt)` and `CampusEntry(userId, lastEntryAt)`, plus a non-negative CHECK (also in `prisma/constraints.sql`).

## Rules a future change must keep

1. **Simulated stays separate from real.** Never write arrivals into `User`, `Character`, analytics, the admin overview or any real count, and never read these tables as if they were real. Do not add `lastActiveAt`/`loginCount` side effects to an entry.
2. **No double counting.** Registered accounts once; do not add online/active players on top.
3. **Server only.** The random draw, the entry decision and the day key are decided on the server. Never accept a number or a "this is a new entry" flag from a browser.
4. **Only genuine entries add arrivals.** Page loads, navigation, refreshes, retries, reconnects, extra tabs and repeated requests must not. Keep the entry claim and the increment in one transaction, and keep both atomic (no read-modify-write).
5. **The day is the game's day** (`dayKey`, `GAME_TIME_ZONE`), computed by one function. Do not use UTC or the server's local time.
6. Keep the broadcast coalesced and monotonic (`at`).

## Tests

* `tests/campus-population.test.mjs` (runs in `npm test`): range of the draw, formula, day rollover, feed and reporter.
* `tests/occupancy-realtime.test.mjs` (runs in `npm test`): the push, with real sockets.
* `tests/pg/campus-population.pg.mjs`: the database behaviour (concurrency, cool-down, rollover, no analytics touched) against real PostgreSQL: `DATABASE_URL=.../lifeinoau_test node tests/pg/campus-population.pg.mjs` (see `tests/pg/bankHarness.mjs`).
