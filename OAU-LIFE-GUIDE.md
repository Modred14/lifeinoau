<!-- OAU-LIFE-GUIDE.md -->
# OAU Life: Project Guide

A multiplayer life-simulation game about student life at Obafemi Awolowo University (OAU), Ile-Ife.
Built with Next.js (App Router), React, PostgreSQL and Prisma. Plain JavaScript, no TypeScript.

> **Status:** about 95 files, all passing syntax checks and 14 test files. Everything was tested against
> *fake in-memory databases*. It has **never been run against a real Postgres or a real Next.js server**.
> Expect to fix small things on the first real run. See "Known limits" at the end.

---

## 1. How to start it (do these in order)

You need: **Node.js 18.17 or newer** (Node 20+ recommended) and a **PostgreSQL database**
(local install, or a free hosted one such as Neon or Supabase).

```bash
# 1. Go into the project folder
cd oau-life-backend

# 2. Install packages
npm install

# 3. Create your .env file from the example, then edit it
cp .env.example .env
#    DATABASE_URL    -> your Postgres connection string
#    SESSION_SECRET  -> 64 random hex characters (command is in .env.example)
#    MARKET_SEED     -> another long random string (never change it after launch)

# 4. Create the tables
npx prisma migrate dev --name init

# 5. Add the database safety rules (constraints). Prisma cannot express these,
#    so they go into a hand-made migration:
npx prisma migrate dev --create-only --name constraints
#    -> open the new file prisma/migrations/<date>_constraints/migration.sql
#    -> it will be empty: paste the ENTIRE contents of prisma/constraints.sql into it, save
npx prisma migrate dev          # applies it

# 6. Seed the fixed data (game clock, system accounts, faculties)
npm run seed

# 7. Start the game
npm run dev
#    open http://localhost:3000
```

**Make yourself an admin** (after you have signed up in the browser):

```bash
node scripts/make-admin.js you@example.com
# then open http://localhost:3000/admin
```

**Run the tests** (they need no database):

```bash
npm test
```

### Important facts about the first run
- The **game clock starts when you run `npm run seed`**. That moment is "week 1". The clock runs **1:1 with real time**: one game minute is one real minute, a day is 24 real hours and a week is 7 real days. Nothing ticks: every time is worked out from the stored epoch and the server clock (`lib/campus-clock.js`, `lib/clock.js`).
- Run the seed only once. It is safe to repeat (it will not duplicate anything), but never delete the `GameClock` row.
- If step 5 fails, the most common reason is that the constraints were pasted into the wrong migration, or applied twice.
- `npm run build` runs `prisma generate` first, then `next build`. `migrate dev` also runs `generate` for you.

---

## 1b. Using this with Next.js

- **Works with:** Next.js 14.2 or 15, **App Router**, plain JavaScript, Node 18.17 or newer. (`cookies()` is awaited, so it behaves the
  same on 14 and 15, and every API route is marked `force-dynamic` so Next never caches a response.)
- **Easiest way:** use this folder *as* your project. Do not merge it into another project unless you have to.
- **If you must merge into an existing Next.js project:**
  1. Copy `app/`, `lib/`, `prisma/`, `scripts/` and `tests/`. Merge `app/layout.js` and `app/globals.css` with your own.
  2. Add the `@/` alias to `jsconfig.json` (or `tsconfig.json`): `"paths": { "@/*": ["./*"] }`.
     If your project keeps code in `src/`, put `app/` and `lib/` inside `src/` and use `"@/*": ["./src/*"]`. `prisma/` stays at the root.
  3. Install: `npm install @prisma/client bcryptjs jose` and `npm install -D prisma`.
  4. Add `"type": "module"` to `package.json` (the seed script and tests use `import`). If you do, your Next config must be
     `next.config.mjs` (or ESM), not a CommonJS `next.config.js`.
  5. Copy the `scripts` from this project's `package.json` (`seed`, `build`, `test`) and the three variables in `.env.example`.
- **File path comments:** line 1 of every file shows its path from the project root, for example `// app/api/signup/route.js`.
  `package.json` and `jsconfig.json` have no comment because JSON does not allow comments; both live in the project root.
- **Safari / local testing:** the login cookie is only marked `secure` in production, so login works on `http://localhost`.

---

## 2. Where every file goes (folder layout)

Next.js rule: **the folder path is the URL**. A `page.js` makes a screen. A `route.js` makes an API endpoint.
The `@/` in imports means "the project root" (set in `jsconfig.json`).

```
oau-life-backend/
├── package.json            scripts and dependencies
├── jsconfig.json           makes "@/lib/..." work
├── next.config.mjs
├── .env.example            copy to .env
├── OAU-LIFE-GUIDE.md       this file
├── prisma/
│   ├── schema.prisma       all database tables
│   ├── constraints.sql     extra database safety rules (paste into a migration, step 5)
│   └── seed.js             clock + system accounts + faculties
├── scripts/
│   └── make-admin.js       promotes a user to admin (server only, no web route)
├── lib/                    ALL game logic lives here, never in React components
├── app/
│   ├── layout.js, globals.css
│   ├── page.js             landing + sign up / log in
│   ├── <screens>/page.js
│   └── api/<endpoint>/route.js
└── tests/                  13 test files + run-all.mjs
```

### Screens (URL -> file)

| URL | File | What it is |
|---|---|---|
| `/` | `app/page.js` | Landing, sign up (18+ checkbox), log in |
| `/play` | `app/play/page.js` | Main game: create character, class reveal, hostel, stats, actions, exams, Floor O |
| `/people` | `app/people/page.js` | Search players, profiles, messages, send money, block/report |
| `/parties` | `app/parties/page.js` | Weekly parties at 0203, Royal Divas, Quantum |
| `/relationship` | `app/relationship/page.js` | Opens the Love app (real players: bonds, requests, dates, babe, sneaky link, proposals, moving in) |
| `/career` | `app/career/page.js` | Jobs and businesses |
| `/invest` | `app/invest/page.js` | Market news, prices, buy and sell investments |
| `/courses` | `app/courses/page.js` | Your four courses, lecturers, attend lectures, study |
| `/leaderboards` | `app/leaderboards/page.js` | FORBES OAU and other boards |
| `/achievements` | `app/achievements/page.js` | Achievement cards |
| `/admin` | `app/admin/page.js` | Admin panel (admins only; others see "Not found") |

### API routes (endpoint -> file)

| Endpoint | Methods | File | Does |
|---|---|---|---|
| `/api/signup` | POST | `app/api/signup/route.js` | Create account (needs 18+ tick) |
| `/api/login` | POST | `app/api/login/route.js` | Log in |
| `/api/meta` | GET | `app/api/meta/route.js` | Faculty list + personalities for character creation |
| `/api/character` | POST | `app/api/character/route.js` | Create character; server draws MAPO/LAPO/NEPO |
| `/api/character/hostel` | POST | `app/api/character/hostel/route.js` | Choose hostel (once) |
| `/api/state` | GET | `app/api/state/route.js` | Everything the game screen needs (also catches the player up on missed weeks) |
| `/api/action` | POST | `app/api/action/route.js` | class, study, rest, safe hustle (2 per in-game day, 6h apart) |
| `/api/parent/call` | POST | `app/api/parent/call/route.js` | Call parent (once per week) |
| `/api/risky` | POST | `app/api/risky/route.js` | Risky hustle (once per in-game day; paid or jailed) |
| `/api/exam` | POST | `app/api/exam/route.js` | Sit or cheat in an exam |
| `/api/fight` | POST | `app/api/fight/route.js` | Report a lecturer brawl; the server decides the cost (70% QRS catch after a win) |
| `/api/floor0/pay` | POST | `app/api/floor0/pay/route.js` | Pay the bail to leave Floor O (N-QRS Custody) |
| `/api/players` | GET | `app/api/players/route.js` | Search players by name |
| `/api/profile` | GET | `app/api/profile/route.js` | Public profile |
| `/api/messages` | GET, POST | `app/api/messages/route.js` | Inbox, conversation, send |
| `/api/transfer` | POST | `app/api/transfer/route.js` | Send money to a player |
| `/api/safety` | POST | `app/api/safety/route.js` | Block or report a player |
| `/api/notifications` | POST | `app/api/notifications/route.js` | Mark notifications read |
| `/api/leaderboard` | GET | `app/api/leaderboard/route.js` | A leaderboard (`?board=forbes`) |
| `/api/achievements` | GET | `app/api/achievements/route.js` | Achievement list |
| `/api/parties` | GET, POST | `app/api/parties/route.js` | List this week's parties, buy a ticket |
| `/api/relationship` | GET, POST | `app/api/relationship/route.js` | The Love app: view everything, or act (`add`, `note`, `food`, `gift`, `request`, `answer`, `cancel`, `breakup`, `forgive`, `apologise`, `fresh`, `remove`) |
| `/api/pregnancy` | POST | `app/api/pregnancy/route.js` | Decide on a pregnancy |
| `/api/career` | GET | `app/api/career/route.js` | Jobs and businesses overview |
| `/api/career/job` | POST | `app/api/career/job/route.js` | Pick, quit, work a shift |
| `/api/career/business` | POST | `app/api/career/business/route.js` | Start, hire, upgrade, withdraw, close |
| `/api/invest` | GET, POST | `app/api/invest/route.js` | Portfolio, buy, sell |
| `/api/invest/live` | GET | `app/api/invest/live/route.js` | Live prices and charts (HTTP fallback for the WebSocket) |
| `/api/courses` | GET, POST | `app/api/courses/route.js` | Your courses and progress; attend a lecture or study a course |
| `/api/admin/overview` | GET | `app/api/admin/overview/route.js` | Integrity check and economy numbers |
| `/api/admin/reports` | GET, POST | `app/api/admin/reports/route.js` | Report queue, resolve |
| `/api/admin/report-messages` | GET | `app/api/admin/report-messages/route.js` | Chat behind a report (logged) |
| `/api/admin/player` | GET | `app/api/admin/player/route.js` | Inspect a player (logged) |
| `/api/admin/adjust` | POST | `app/api/admin/adjust/route.js` | Audited money adjustment |

Every route does the same four things in order: check the session, rate-limit, call a function in `lib/`, return JSON.
Routes contain no game rules.

### The `lib/` folder (the real game)

Grouped by job. Files marked *pure* have no database access and are the easiest to test.

| Group | Files |
|---|---|
| Foundation | `rules.js` (hostel, class and player-to-player transfer rules), `rng.js` (secure random), `clock.js` (week from server time), `auth.js` (sessions), `client.js` (browser helper), `ratelimit.js` |
| Money | `ledger.js` (**the only code allowed to move money**) |
| Weekly simulation | `tick.js` (catches a player up on missed weeks: allowance, rent, exams, sessions, childcare, businesses, investments valuation) |
| Rules (*pure*) | `engine.js` (actions, risk, exams, progression), `parties.js`, `relationships.js`, `jobs.js`, `business.js`, `market.js`, `achievements.js`, `curriculum.js` (courses and fictional lecturers), `courses.js` (attendance, preparation, exams, surprise tests) |
| Services (touch the database) | `gameService.js`, `relationshipService.js`, `careerService.js`, `investService.js`, `courseService.js`, `achievementService.js`, `notifications.js`, `leaderboards.js`, `admin.js` |

### Order to put the files in (if you copy them by hand)

If you downloaded the whole folder, nothing to do. If you are assembling it manually, create files in this order
so you can run and check as you go:

1. **Project root:** `package.json`, `jsconfig.json`, `next.config.mjs`, `.env.example` (then make `.env`)
2. **`prisma/`:** `schema.prisma`, `constraints.sql`, `seed.js`
3. **`lib/` foundation:** `rules.js`, `rng.js`, `clock.js`, `engine.js`, `ledger.js`, `ratelimit.js`, `auth.js`
4. **`lib/` rules:** `parties.js`, `relationships.js`, `jobs.js`, `business.js`, `market.js`, `achievements.js`
5. **`lib/` services:** `tick.js`, `notifications.js`, `achievementService.js`, `gameService.js`, `relationshipService.js`, `careerService.js`, `investService.js`, `leaderboards.js`, `admin.js`, `client.js`
6. **`app/api/**/route.js`:** all routes (create the folders exactly as in the table above)
7. **`app/`:** `layout.js`, `globals.css`, `page.js`, then each screen folder's `page.js`
8. **`scripts/make-admin.js`** and **`tests/`**

Then run steps 2 to 7 from section 1.

---

## 3. How the game works (rules as built)

**Time.** Strictly 1:1 with real time: a game minute is a real minute, an in-game day is 24 real hours and a week is 7 real days, all derived from the
server clock and the `GameClock` row (never from a browser, never from a timer, so a refresh, logout, restart or reconnect cannot move it). Each player is "caught up" on
missed weeks whenever they make a request. If nothing new has happened, the catch-up does nothing. Every deadline in the game (sentences, suspensions, expulsions,
hustle cooldowns) is a stored timestamp; `getState` and `/api/travel` return `serverNow`, and every screen counts down against it (`lib/serverClock.js`), so devices with wrong clocks still agree.

**Character.** Gender, faculty, at least one personality (Party Animal, Introvert, Extrovert, Shana).
Class is drawn by the server: **MAPO 60%, LAPO 30%, NEPO 10%**. Players must tick that they are 18+ at sign-up.

**Allowance per week:** NEPO ₦500,000, MAPO ₦100,000, LAPO ₦30,000. Calling your parent once each week
keeps it intact. Each missed week cuts the next allowance by 10% (maximum 50%). Rent: school hostel ₦2,000,
off-campus ₦6,000, Ojaja ₦15,000 a week.

**Hostels.** NEPO: Ojaja or off-campus. MAPO: three school hostels of their gender plus off-campus, and Ojaja from
200L. LAPO: all four school hostels of their gender plus off-campus. Women: Moremi, Mozambique, Akintola, Alumni.
Men: Awo, Fajuyi, Angola, ETF.

**Academics.** Each level you take **four courses** (game content, not the official OAU curriculum) taught by fictional lecturers
with their own difficulty, personality and teaching style. Science-like faculties (Science, Technology, Computer Science, Pharmacy,
Agriculture) get Mathematics with **Boroks**: loud, strict and the toughest lecturer, who loves surprise tests. Your **ability**
(the academics stat) is fixed at the start. What you can change is **effort**: attend a lecture (12 energy) and study (15 energy),
once per course per week. Attendance and preparation in each course, plus your energy, luck and the lecturer's difficulty, decide
your exam score, which is the average of your four courses. Lecturers can also spring a **surprise test** during the weeks, scored
out of 20 from the effort you have put in. Sessions are 12 weeks with 2 exams (every 6th week of the player's own timeline).
Missing an exam is an automatic fail. An average grade point of 1.0 or more advances you (100L to 500L). Two failed sessions in a row
means withdrawal. Graduation at 500L gives a Nigerian-style class (First Class from 4.5 and so on). CGPA is the average over every
exam sat. Cheating adds marks, but a caught cheat caps the score at 25 and adds a strike.

**Hustles (all limits are enforced on the server, in `lib/engine.js` + `lib/gameService.js`; the screens only read them).**
One in-game day is 24 real hours, counted from the game clock's epoch (`dayWindow` in `lib/clock.js`).
- Safe hustle: 20 energy, pays a random ₦1,500 to ₦15,000. At most 2 per in-game day, and at least 6 hours between attempts (the gap also holds across the day change).
- Risky hustle (labelled VERY RISKY, ₦100,000 to ₦500,000): 25 energy, once per in-game day. Two outcomes only: N-QRS catches you (chance rises with suspicion), or you are paid a random ₦100,000 to ₦500,000.
- The counts come from `ActionLog` rows (written in the same transaction as the hustle, so a failed hustle never counts; the player row is locked, so two quick taps cannot both pass). `getState` returns them as `hustle`.

**Floor O and bail.** Caught on a risky hustle: Floor O for 30 minutes to 1 hour 30 minutes, lose 15 health, 25 energy and 10 happiness, the
QRS seizes 30% of your cash. Bail is ₦3,500 for every minute of the sentence still to serve (a started minute counts), so it falls ₦3,500
each minute served and is worked out on the server at the moment of payment (`bailFor`). Fighting a lecturer jails you for 30 minutes to 3 hours but uses the same bail rule.
Strikes: 3 or 4 means a **2 real hour suspension**, 5 means a **5 real hour expulsion**. A suspended player can still pay bail.

**Floor O (N-QRS Custody).** A sentence is served *inside* Floor O: the arrest moves the player to the map place `floor0`, and `FloorZero` keeps when custody started
(`startedAt`), when it ends (`releaseAt`) and where (`location`), with `Character.jailedUntil` as the enforced deadline. While it is active every state-changing action is
refused on the server (`loadLocked` in `lib/gameService.js`): no actions, travel or teleport (`/api/travel`), road positions, hiring, housing, shop, money transfers, parties or
games. A presence ping can only confirm Floor O. **Messaging stays open** (it never goes through `loadLocked`). Bail still ends the sentence early. When the time is up the player is
released automatically, with nothing to pay: the next request of any kind (or `settleCharacter`) clears `jailedUntil` and closes the custody record. The home screen shows the custody
screen instead of the room, the map and phone are limited to messages, and other players see the prisoner at Floor O only.

**Discipline and daily energy (`lib/discipline.js`).** Suspension (`suspendedAt`/`suspendedUntil`, 2 hours) and expulsion (`expelledAt`/`expelledUntil`, 5 hours) are real-time deadlines
enforced on the server; whether one is active is always decided by comparing the stored deadline with the server clock, so an expired penalty can never stay active and no refresh
or API call can shorten or skip a running one. When an expulsion ends the player **starts again at 100L**: a fresh session and exam count from that week, no strikes or failed sessions, and
CGPA counted from the restart (`Character.restartWeek`; older exam results are kept, they just stop counting). The account, money, home, businesses, relationships, messages and
achievements are untouched, and the weeks spent expelled are not caught up. Energy refills to 100 once per in-game day (`energyRefilledAt`), not in the weekly catch-up.

**Fighting a lecturer.** Every lecturer stands in a real lecture room (`lib/lectureVenues.js`: your four courses get four different rooms, in your faculty
building first and then the big lecture theatres; the Courses app shows where, with a "Show on map" link). To confront one you travel to that building, go in,
and walk up to the lecturer (the red ring with their name): the server checks from what it recorded (your last trip ended at that building and it heard
from you there in the last 4 minutes, not in custody, suspended or expelled, 20 energy, once a week, nobody else's N-QRS response running in that room) and opens a
10 minute **encounter** (`POST /api/lecture {action:"approach"}`, `lib/lectureService.js`, table `LectureEncounter`). The full-screen 3D brawl
(`components/LectureFight.js`, `lib3d/lectureScene.js`, rules `lib/fightSim.js`, tested in `tests/fight.test.mjs`) is played against that encounter and
`POST /api/fight` is refused without it. The browser reports who won; `lib/fight.js` + `lib/fightService.js` decide the cost and settle everything in ONE transaction.
- **You lose:** -20 health, -10 happiness, -5 popularity. Nobody comes.
- **You win, and slip away (20%):** +15 happiness, +8 popularity, +25 suspicion. N-QRS still arrives, rescues the lecturer, finds nobody to arrest and leaves (39 s).
- **You win and N-QRS catches you (70%):** they arrive, **rescue the lecturer**, apprehend **you** and walk you out to Floor O (57 s). The usual arrest rules apply
  (30% of cash seized, bill, sentence served inside Floor O, a strike, reason "Beat up <lecturer>"). The lecturer is never the one arrested.
The response is a **timeline stamped by the server** from the moment the fight was settled (`lib/lectureResponse.js`); `lib3d/interiors/lectureEncounter.js`
turns server time into where everyone stands and `lib3d/interiors/scene.js` draws it, so a refresh, a second tab or a reconnect resumes at the right moment
(the state answer carries `lectureIncident`, and the map reopens the room) and nothing can restart or repeat it. Only one response can run per lecture room
(partial unique index `one_active_lecture_response`), one open encounter per player (`one_open_lecture_encounter`), and one fight per week; a repeated fight request returns the
recorded result (`duplicate: true`) instead of arresting again. Migration: `20261018000000_lecture_encounters`.

**Parties.** Each of 0203, Royal Divas and Quantum hosts one party per week (price roughly ₦8k to ₦30k, limited
capacity). One night out per player per week, with a random outcome on the night.

**Love (real players).** You can only start something with a player you have messaged and who has messaged you back (Messages app).
Opposite genders start as *talking*; the same gender is a *bestie* and stays one. Dates (2, one a week), buying them food (1) and having them
over to your side (1) unlock asking them to be your **babe** (one at a time, for both of you) or your **sneaky link** (up to 2). A date, a visit,
hanging out and a night in are *invites* the other player accepts; food, gifts and notes happen at once. After 1 week as babe you can **propose**
(you buy the ring only if they say yes). You can **take your babe home** (they move into your home, you cover the rent or they pay their own) but
only while you live off campus. Either of you can break up at once; an ex can be asked for another chance within 4 weeks. Keep a sneaky link while
you have a babe and each time you link up the babe may catch you: affection drops 35, the babe must forgive you (you can say sorry with a gift),
and being caught twice ends it. Affection fades 3 a week without contact (1 a week when living together). A night in can lead to the pregnancy
decision. Everything is text-only and non-graphic. Rules: `lib/relationships.js` (pure, shared with the phone), service: `lib/relationshipService.js`,
instant screen changes: `lib/lovePatches.js`, tables: `Bond`, `LoveRequest`, `BondEvent`.

**Jobs.** 12 jobs (Vendor, Barber, Lash Tech, Developer, Tech Bro and more). Up to 5 shifts a week. Pay rises 12% per
job level. Some need 200L or 300L, and some need a specific faculty.

**Businesses.** 10 types (₦200k to ₦1M to start). The number you can run equals your level (1 at 100L, up to 5).
Hire up to 8 staff, upgrade to level 5, add or withdraw capital (a safety reserve stays inside). Each week brings
revenue, expenses and random events. A business with no capital left goes bankrupt. Businesses keep trading after graduation.

**Investments.** Six fictional products from low risk to high risk, traded in a LIVE market that is always open. Prices move every second
(`lib/marketEngine.js`): each product has its own volatility, with calm spells, trends, reversals, bursts, and rare sharp rises and crashes
(a price can double and then halve again within minutes). A price is a pure function of a secret key (`MARKET_SEED`) and the server clock, so every
server computes the same number, the market keeps moving while nobody is online, a restart cannot reset it, and nobody can predict or change it.
Orders are filled at the server's price at that instant, under the player's row lock and inside one database transaction (`lib/investService.js`).
The Invest app shows live prices, 5 min / 1 h / 24 h changes and charts, and the portfolio with realised and unrealised profit or loss
(over the WebSocket in `realtime/server.js`, or `/api/invest/live` over HTTP if it is down). 1% fee each way, 5% penalty for selling inside a
lock period, and a total cap of ₦5M times your level number (100L = ₦5M, 200L = ₦10M and so on).

**Player money.** Transfers between players: ₦100 to ₦5,000,000 each, ₦10M a day, plus a 2% fee that leaves the economy.

**Safety tools.** Block and report. Admins can read only the last 20 messages behind an open report, and every read is logged.

---

### Getting around the map (roads, vehicles and trips)

A driven ride (keke, bus, car with a driver) lasts a set time that **grows with the road distance** between the two stops, inside a window for each vehicle:
**car with a driver 6 to 9 seconds, bus 8 to 10 seconds, keke 10 to 15 seconds** (`RIDE_SECONDS`, `rideSecondsFor()` in `lib/travel.js`: a hop of 150 m or less takes the low
end, 2.4 km or more the high end, and everything between is spread evenly by distance). The vehicle still pulls away, slows for bends and junctions and brakes to a stop; that motion
is recorded by `rideProfile()` in `lib3d/trafficsim.js` and played over exactly that time. **Walking to the vehicle never takes more than 5 seconds**: a kerb that is further than
that is walked at a faster pace (`Walker.glide`), and the vehicle comes up the road in the same time. Your own car, which you steer, and the trek are not timed this way, and the
walk from where you get out to the door is at the normal walking pace (2.6 m/s). The travel sheet shows the estimate for every choice before you go. How it works:

- **The road network** is `public/data/oau-roadgraph.json`, generated from the map's road polygons by `python3 tools/oau/roadgraph.py` (`npm run build:roads`; needs numpy,
  scipy and scikit-image, the game itself does not). It holds the centrelines, the junctions and how wide each road is. Run it again whenever the roads or buildings in
  `oau-campus.json` or `lib3d/mapExtras.js` change: `tests/roadgraph.test.mjs` fails when the file is out of date. `lib3d/roadgraph.js` turns it into two lanes per road
  (traffic keeps right), curved turns through junctions, pavements, crossings and routing. Alleys too tight for a car become footpaths.
  The generator's output is kept untouched as `tools/oau/roadgraph.raw.json`; `node tools/oau/refine-roads.mjs` (`lib3d/roadrefine.js`) then classifies every road (express / collector / local),
  straightens it into long runs with gentle fillets, joins broken fragments, prunes redundant stubs, loops and parallel duplicates without isolating any place, and adds the expressway
  (`lib3d/highway.js`), writing `public/data/oau-roadgraph.json`. Class decides the cross-section (median, lanes each way, shoulder, a strip of pavement kept against buildings).
- **The expressway** (`lib3d/highway.js`, drawn by `lib3d/highwaymesh.js`) is a 4.2 km elevated dual carriageway across the lake, 10 m up, three lanes each way, a median barrier, shoulders and
  parapets, on T-piers, with a half-diamond interchange at the west end and a full diamond at the campus. Roads carry a level mask (`LV_GROUND`, `LV_DECK`, `LV_RAMP`): people and ambient traffic only
  see the ground; a vehicle sees its own level plus the ramps, and where a ramp runs on to the deck it takes the surface at the height it is at, so the deck stays level. `tests/road-network.test.mjs` covers it.
- **What is solid** is `lib3d/collide.js`: every building and lake outline as exact edges, plus the walls and stage of the grounds, plus every vehicle as a box. People
  (`lib3d/walker.js`, which also plans walking routes round buildings and parked cars) cannot enter any of it, and cars stay on the road.
- **Traffic** is `lib3d/trafficsim.js` (pure logic; `lib3d/traffic.js` only draws it): vehicles follow lanes, keep their distance, give way at junctions and to the player.
- **A trip** is planned by `lib3d/tripplan.js` (the route, the stopping places and the estimate) and run by `lib3d/tripflow.js` (a state machine: you walk to the vehicle, it
  stops at the kerb, you board by its right-hand door, it drives the route, you get out and walk to the door). `lib3d/travel.js` draws it. The estimate and the trip use the same
  motion rules, so on an empty road they agree to about 1%; other traffic adds a little, and the time shown while you travel is worked out again from where things are.
- `lib/travel.js` also keeps `minTravelMs`, the soonest a trip could honestly be finished (distance over the vehicle's top speed), for any server check of arrivals.

## 4. Money rules (the part that must never break)

- All money is **integer kobo** (1 naira = 100 kobo). No decimals touch the ledger.
- All money moves go through `lib/ledger.js` as double-entry rows. Ledger rows cannot be edited or deleted (a database
  trigger blocks it).
- Player balances can never go below zero (a database CHECK enforces it).
- Every action carries a `requestId`, so a double-tap or retry changes nothing twice.
- Only player accounts are locked during transfers, so shared system accounts are never a bottleneck.
- System accounts: `WORLD` (money created and removed), `LANDLORDS`, `PARENTS`, `QRS`, `TRANSPORT`, `VENUES`,
  `CLINICS`, `BUSINESS` (capital held inside businesses), `MARKET` (investment buys and sells).
- The admin overview checks that every player's cached balance matches the ledger and that the `BUSINESS` account
  matches the capital held in businesses.
- Admins can only change money through a normal ledger entry against `WORLD`, with a written reason, capped at
  ₦1,000,000 per action, and every one is written to the audit log.

## 5. Economy balance (from simulations)

| Thing | Result over 60 weeks |
|---|---|
| Honest MAPO allowance | about ₦5.9M after rent |
| Risky hustling, greedy | expelled 100% of the time, within about 10 weeks |
| Risky hustling, occasional | about ₦390k net, expelled 31% of the time |
| Student by effort (all four courses, Science) | full effort: CGPA about 4.2 and 100% graduate; balanced: about 3.2; light: 74% graduate; minimal: about 1% |
| Food business, 4 staff, withdrawing | median about ₦3.3M |
| Food business, 8 staff, saving and upgrading | median about ₦15.7M |
| Tech business, careful vs thin buffer | median about ₦8.6M vs 70% go bankrupt |
| Low-risk investment | +24% to +32%, no losses |
| Medium-risk investment | median +50%, 3% to 9% end below start |
| High-risk investment | most players lose; the best 10% get 3x or more |

These are starting numbers. Real players will find strategies the simulations did not. Watch the admin overview.

---

## 6. Known limits and what is NOT built

**Not run for real.** Never executed against real Postgres or `next dev`. Specific risks:
- Raw SQL (row locking, the capacity counter for parties, the rate limiter, the Forbes join, the admin integrity
  query) is written for Postgres but untested.
- Real concurrency (two players buying the last party ticket at once) is untested.
- Prisma `groupBy` queries on the leaderboards need a first real run.

**Missing from your spec:**
- The interactive **OAU map and locations** (the server does not track where a player is, so actions work from anywhere).
- Transport choices (trek, shuttle, bike off campus, Daddy Benz). The rules are in the prototype only.
- Departments and assignments. (Courses, fictional lecturers including Boroks, attendance, preparation and surprise tests ARE built.
  Lecture slots are flavour only.) Fighting a lecturer IS built (see "Fighting a lecturer"); bribing one is not; the Yahoo-style hustle is the generic risky hustle.
- Daily and weekly objectives, audio, the cinematic onboarding, the full landing page (features, FAQ).
- Hostel changes (so MAPO players cannot yet use the 200L Ojaja unlock).
- Live updates (everything refreshes on request or on a timer; no websockets yet).

**Check before launch:**
- **Faculty names** in `prisma/seed.js` are unverified against the official OAU site. After checking, set `verified = true`.
- Run behind a proxy you control (Vercel, Nginx) so the rate limiter reads real IP addresses.
- Set strong `SESSION_SECRET` and `MARKET_SEED` and never commit `.env`.
- Add a privacy notice and terms (messages, reports and an 18+ confirmation are stored).
- Old ledger rows and rate-limit rows grow forever. Plan clean-up and database backups.

## 7. Suggested next steps

1. Do the first real run (section 1) and fix whatever breaks. This matters more than any new feature.
2. Add the campus map and transport, then departments and assignments.
3. Objectives and rewards, then audio and the full landing page.
4. Deploy: Vercel for the app, Neon or Supabase for Postgres. Set the three environment variables, run
   `npx prisma migrate deploy`, then `npm run seed` once.

---

## 8. What was decided during the chat

| Topic | Decision |
|---|---|
| Time | 1:1 with real time (1 game minute = 1 real minute; week = 7 real days); sessions are 12 weeks |
| Money | Integer kobo in a double-entry ledger |
| Game time engine | Catch-up on request, no per-player cron job |
| Sign-up | Must tick "I am 18 or older" |
| Messages in admin | Not browsable; only through a report, last 20, logged |
| Lecturer names | Fictional only (Boroks stays fictional) |
| MAPO hostels | Same rules for men and women with their own hostels; Ojaja is for both |
| Starting academics | Raised from 25-55 to 35-60 (otherwise a third of players would struggle from week one) |
| Relationships | Real-player romance with consent (every ask is answered by the other player), text-only, non-graphic |
| Faculties | 12 listed including Computer Science; names still to be verified |
| Courses | Four per level per faculty, fictional lecturers; ability is fixed, effort (attendance and preparation) decides results |
| Styling | Plain CSS reused from the prototype instead of Tailwind |

## 9. Bugs found and fixed while building (so you know the test suite earns its keep)

- Players could reroll their class by retrying hostel selection. Fixed: the class is saved the moment it is drawn.
- Repeated "study" requests counted twice. Fixed with the action log.
- Risky hustles paid far more than honest work. Retuned, plus a 30% cash seizure.
- Replays wrote a second admin audit entry. Fixed.
- The business economy had a wage loophole turning ₦300k into ₦55M. Fixed.
- The investment market had a negative average and ruined MemeCoin. Retuned.
- **The weekly catch-up refilled energy on every request.** Fixed, with a regression test.
- A graduating player's business stopped trading. Fixed.
- Course actions that raised the academics stat made every student a perfect scorer within six weeks. Fixed: ability stays fixed.
- The weekly catch-up made two needless database queries on every request before checking for nothing to do. Fixed.

## 10. Test files

Run them all with `npm test`. Each file prints what it checked.

| File | Covers |
|---|---|
| `tick.test.mjs` | Weekly catch-up: sessions, withdrawal, graduation, childcare, pregnancy, businesses, no free energy |
| `campus-clock.test.mjs` | The strict 1:1 clock: week and day boundaries derived from stored timestamps |
| `lecture.test.mjs` | Lecture rooms and venues, the encounter, the N-QRS response timeline, one arrest per fight, no duplicate responses, replays and concurrent requests |
| `lectureScene.test.mjs` | Where everyone stands during the response (pure), and every lecture room reachable from the front door |
| `discipline.test.mjs` | 2 hour suspension, 5 hour expulsion and restart at 100L, daily energy, Floor O (N-QRS Custody): no escape, messaging allowed, persistence, auto-release, server-clock countdowns |
| `p2p.test.mjs` | Player-to-player transfers, fee, replays |
| `rl.test.mjs` | Rate limiter |
| `admin.test.mjs` | Admin access, audited adjustments, reports |
| `lb.test.mjs` | Leaderboards: ranks, ties, cache, Forbes breakdown |
| `party.test.mjs` | Party generation, nights, ticket purchase, sell-outs |
| `love.test.mjs` (+ `fakedb.mjs`) | Love rules and the whole journey between real players: talking, dates, babe, sneaky link, getting caught, proposal, moving in, breakup, pregnancy |
| `ach.test.mjs` | Achievements |
| `courses.test.mjs` | Curriculum, Boroks, attendance and study rules, effort-driven exams, course service |
| `biz.test.mjs`, `career.test.mjs` | Business economics simulation, jobs and businesses service |
| `market.test.mjs`, `inv.test.mjs` | Market simulation, buying and selling |
| `travel.test.mjs` | Fares, vehicle speeds, driver plans, place ids, the road net and door positions |
| `roadgraph.test.mjs` | The generated road graph is current; right-hand lanes, smooth turns, a car-sized box stays on the road and out of buildings, routing |
| `collide.test.mjs` | Exact collision: no entering buildings at any speed or frame rate, no tunnelling, sliding along walls, vehicles are solid |
| `trafficsim.test.mjs` | NPC traffic for minutes at several frame rates and places: on the road, in lane, no overlaps, no teleporting, no jams; the shared braking model |
| `walker.test.mjs` | Walking routes round buildings and cars, same walk at any frame rate, the player taking over from the automatic walk |
| `tripflow.test.mjs` | Whole journeys in every mode: boarding by the right-hand door, estimate vs real time, longer trips take longer, same at any frame rate, no teleporting, cancelling |
