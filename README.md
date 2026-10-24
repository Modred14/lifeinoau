<!-- README.md -->
# OAU Life

OAU Life now includes the Campuslife world, focused on Obafemi Awolowo University. Existing OAU accounts, characters, homes, money, courses, relationships, businesses, investments, betting, achievements and messages remain available.

`/play` opens the live campus. `/home` keeps the original room and daily actions, `/map` keeps the original OAU map, and the **OAU apps** button opens the existing phone apps. The campus phone adds its timetable, registration, handouts, shops, events, union, errands and travel tools. `/rider` is the restricted errands board.

## Run locally

Use Node.js 22.9 or newer and PostgreSQL. From a normal clone:

```sh
git clone https://github.com/Modred14/lifeinoau.git
cd lifeinoau
npm ci
cp .env.example .env
```

Set `DATABASE_URL` and fill `SESSION_SECRET`, `AUTH_PROXY_SECRET`, `MARKET_SEED` and `DRAW_SECRET` with separate random values. `openssl rand -hex 32` generates a suitable value. Never expose `AUTH_PROXY_SECRET` to the browser. Both services must use the same database and session secret.

```sh
npx prisma migrate deploy
npm run seed
npm run dev
```

The web app runs on port 3000 and the campus service on port 2567. The campus service applies its own additive Drizzle migrations on startup, after the OAU Prisma migrations. Existing OAU installations should back up their database before applying migrations. The optional original Socket.IO chat service runs with `npm run realtime` on `REALTIME_PORT` (4000); messages keep their existing HTTP fallback when it is stopped.

Browser message alerts can arrive while the game is closed when the browser/device supports Web Push and the player grants notification permission. For production, configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and a separate random `PUSH_SUBSCRIPTION_SECRET` (at least 32 characters) on both the website and realtime service, then run `npx prisma migrate deploy`. Generate VAPID keys with `npx web-push generate-vapid-keys`; generate the storage secret with `openssl rand -hex 32`. Push subscriptions are encrypted in the database. Without HTTPS, browser/device support, permission, or these server keys, only in-game alerts and chat polling are available.

For a production build:

```sh
npm run build
npm start
```

Configure HTTPS/WSS for the public campus service, set `NEXT_PUBLIC_GAME_SERVER_URL` before building, and list the exact web origins in `ALLOWED_ORIGINS`. Set `GAME_SERVER_INTERNAL_URL` to the private HTTP address used by Next.js. Keep the database and proxy secret private. The campus service holds live rooms and single-use join tickets in memory; run one instance unless adding shared matchmaking and ticket storage.

## Integrated behaviour

The OAU ledger is the only game wallet. Campus purchases, wages, fares, fines, refunds and union payments settle with the world save in one database transaction. Original OAU transfers appear in the world, and reconnecting restores progress. The existing character sets the school, level, faculty and background; clients cannot choose another school or reset their balance.

Physical classes and reading contribute to the existing OAU course record. Weekly campus assessments stay separate from degree progression; the Saturday assessment during an OAU exam week contributes to the original exam record. The existing six-week exam and twelve-week session rules still govern the degree. Existing OAU hostel residents own their matching campus bed; off-campus residents can use the campus ballot and squatting interactions.

The game clock runs strictly 1:1 with real time: a game minute is a real minute, a day is 24 real hours and a week is 7 real days, derived from the server clock and stored timestamps only. The migration rebases the clock row and keeps the current OAU week, how far into it you are, and all academic progress. Suspension lasts 2 real hours and expulsion 5 real hours (then the player starts again at 100L); a sentence in Floor O (N-QRS Custody) is served inside Floor O, with messaging still open; energy refills once per in-game day. See `lib/discipline.js` and `OAU-LIFE-GUIDE.md`.

The world includes walking/running, camera and touch controls, wardrobe and emotes, interiors, seats and beds, hunger and illness, queues, food and delivery jobs, power/water conditions, buses and player driving, hailing and fares, traffic, worship, parties, sports, stage shows, registration, handouts, ballots, porter raids, student politics and campus news.

**Errands are real requests, separate from simulated food deliveries.** They use pay-on-delivery and never debit game money. Rider access must be granted by an operator. Vendor entries retain their source and checked date; no external payment gateway or outside delivery provider is connected.

```sh
npm run staff -w @campuslife/server -- grant rider "OAU character name"
npm run staff -w @campuslife/server -- list
npm run staff -w @campuslife/server -- revoke rider "OAU character name"
```

## Administrator console

Open `/admin` while signed in as an administrator (anyone else gets a plain 404). Grant the role from the server, never from the website:

```sh
node scripts/make-admin.js you@example.com
```

Pages: Overview (real analytics with their definitions), Online players (live), All players (every account since launch, with CSV export), a player file with every action, Forbes OAU, Economy, Moderation, Game systems, Announcements and the Audit log.

- **Money** is exact: amounts are typed as text, handled as BigInt kobo and never rounded. There is no cap on administrative grants other than the database's own bigint limit (₦92,233,720,368,547,758.07). Every change is one transaction with its audit row, safe to retry, and records admin, player, amount, reason, time, previous and new balance.
- **Delete** archives an account (`User.status = DELETED`): it can never log in and disappears from search, maps, chat and leaderboards, but the ledger and character are kept so money still adds up. It can be restored. **Suspend** is timed or until restored, and takes effect on the next request and on the chat socket.
- **Presence** (online, idle, disconnected, offline) comes from heartbeats and the realtime server, never from "recently active". Set `REALTIME_URL` so Idle can be detected.
- **History**: per-account login and activity tracking starts with the migration `20261022130000_admin_console`. Older accounts show the newest of the game's earlier signals (presence, map heartbeats, action log); accounts erased by hand before this cannot be listed, and none are invented.
- Game rules (prices, pay, cooldowns) are constants in code, so that page is read only. Faculty difficulty and the SUG calendar are live-editable.

Tests: `node tests/admin-console.test.mjs` (no database) runs with `npm test`. `tests/pg/admin/run.sh` runs the database suites against a throwaway Postgres (see the header of that file).

## Checks

```sh
npm run typecheck
npm run test:campus
npm test
npm run build
```

The live integration check requires the web app on port 3177, campus service on 2567, matching origins, and a disposable local database named `lifeinoau_campus_integration`. It refuses other databases and creates synthetic accounts and orders.

```sh
npm run dev:web -- --port 3177
npm run start:campus
npm run test:campus:integration
```

## Source and credits

The integrated Campuslife source is under `campus/`, with public assets under `public/campus`. Original OAU code and assets retain their locations. The original Campuslife checkout is not needed to install or run this repository.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Tree/shrub positions use Meta and WRI’s Global Canopy Height Map, ESA WorldCover and Google Open Buildings (CC BY 4.0). Character models by [Quaternius](https://quaternius.com), CC0; credits are included with the models. Raw CC0 garment fixtures are included for reproducible geometry tests. The source school directory is retained as data, while enrolment is restricted to OAU.