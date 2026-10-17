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
- The **game clock starts when you run `npm run seed`**. That moment is "week 1". One real day = one week.
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
| `/api/fight` | POST | `app/api/fight/route.js` | Report a lecturer brawl; the server decides the cost (80% QRS catch after a win) |
| `/api/floor0/pay` | POST | `app/api/floor0/pay/route.js` | Pay the bill to leave Floor O |
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
| `/api/invest` | GET, POST | `app/api/invest/route.js` | Market, buy, sell |
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
| Foundation | `rules.js` (hostel and class rules, transfer limits), `rng.js` (secure random), `clock.js` (week from server time), `auth.js` (sessions), `client.js` (browser helper), `ratelimit.js` |
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

**Time.** One real day = one week, decided by the server clock. Each player is "caught up" on missed weeks
whenever they make a request. If nothing new has happened, the catch-up does nothing.

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
One in-game day is one real day, counted from the game clock's start (`dayWindow` in `lib/clock.js`).
- Safe hustle: 20 energy, pays a random ₦1,500 to ₦15,000. At most 2 per in-game day, and at least 6 hours between attempts (the gap also holds across the day change).
- Risky hustle (labelled VERY RISKY, ₦100,000 to ₦500,000): 25 energy, once per in-game day. Two outcomes only: N-QRS catches you (chance rises with suspicion), or you are paid a random ₦100,000 to ₦500,000.
- The counts come from `ActionLog` rows (written in the same transaction as the hustle, so a failed hustle never counts; the player row is locked, so two quick taps cannot both pass). `getState` returns them as `hustle`.

**Floor O and bail.** Caught on a risky hustle: Floor O for 30 minutes to 1 hour 30 minutes, lose 15 health, 25 energy and 10 happiness, the
QRS seizes 30% of your cash. Bail is ₦3,500 for every minute of the sentence still to serve (a started minute counts), so it falls ₦3,500
each minute served and is worked out on the server at the moment of payment (`bailFor`). Fighting a lecturer jails you for 30 minutes to 3 hours but uses the same bail rule.
Strikes: 3 means a 2-week suspension, 5 means expulsion. A suspended player can still pay bail.

**Fighting a lecturer.** On the Courses app, "Fight <lecturer>" (20 energy, once per week, behind a confirm) opens a full-screen 3D brawl
(`components/LectureFight.js`, scene in `lib3d/lectureScene.js`). It plays itself (auto-fight) so you watch your character beat the lecturer, and you can
take control at any moment (Punch / Kick / Block / Dodge buttons, or Space-J / K / hold L / S-D, T toggles auto). The brawl is `lib/fightSim.js`
(pure, tested in `tests/fight.test.mjs`). The browser reports who won; `lib/fight.js` + `lib/fightService.js` decide the cost.
If you lose: -20 health, -10 happiness, -5 popularity. If you win: **80% the QRS van comes** (`DSA_CATCH_PERCENT`): the cutscene shows the van arriving with sirens,
officers chasing you down, carrying you into the van and driving you through the Floor O gate; the normal arrest rules apply (30% of cash seized, bill,
sentence, a strike, reason "Beat up <lecturer>"). The other 20% you run away (+15 happiness, +8 popularity, +25 suspicion). The cutscenes are pure functions of
time (`seek(name, t)` jumps to any moment) and have a Skip button.

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

**Investments.** Six fictional products from low risk to high risk. Prices come from a secret, deterministic series, so
all players see the same market and nobody can influence it. 1% fee each way, 5% penalty for selling inside a lock period,
and a total cap of ₦5M times your level number (100L = ₦5M, 200L = ₦10M and so on).

**Player money.** Transfers between players: ₦100 to ₦5,000,000 each, ₦10M a day, plus a 2% fee that leaves the economy.

**Safety tools.** Block and report. Admins can read only the last 20 messages behind an open report, and every read is logged.

---

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
| Time | 1 real day = 1 week; sessions are 12 weeks |
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