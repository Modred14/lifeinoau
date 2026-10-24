realtime/README.md

# Realtime chat server

The website runs on Vercel, which cannot keep a connection open. Real-time chat (messages that arrive instantly, ticks, online
status, typing) therefore runs as one small extra Node program from this same repository: `realtime/server.js` (Socket.IO).

You can skip it. If `REALTIME_URL` is not set, the Messages app still works over plain HTTP with light polling, just without
instant delivery, online status or typing.

## What to set up

1. Host the server on any Node host that allows long-running processes (Render, Railway, Fly.io, a VPS).
   * Build command:  `npm install && npx prisma generate`
   * Start command:  `node realtime/server.js`
   * It needs a **paid/always-on** instance. Free instances that go to sleep make the first message slow.
2. Give it these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the same database as the website (use the pooled connection string on Neon or Supabase) |
| `SESSION_SECRET` | the **same** value as the website |
| `APP_ORIGIN` | your website address, e.g. `https://lifeinoau.vercel.app` (comma separated for more than one) |
| `PORT` | set by most hosts automatically |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | the same Web Push VAPID values as the website |
| `PUSH_SUBSCRIPTION_SECRET` | the same random 32+ character encryption key as the website |

3. On the website (Vercel) add one variable: `REALTIME_URL` = the address of the server, e.g. `https://oau-realtime.onrender.com`.
4. Apply the new migration to the database: `npx prisma migrate deploy`.

## Run it locally

```
npm run dev        # terminal 1: the website
npm run realtime   # terminal 2: reads .env, listens on :4000
```
Add `REALTIME_URL="http://localhost:4000"` and `APP_ORIGIN="http://localhost:3000"` to `.env`.

## Keeping the database small

* Only the newest 150 messages of each chat are kept, and nothing older than 30 days. Change with `CHAT_KEEP_PER_CHAT` and `CHAT_KEEP_DAYS`
  (set them on both the website and this server).
* "Read" and "delivered" are one number per side on a tiny `Chat` row, not a flag on every message.
* "Online" lives in this server's memory and is never written to the database. "Last seen" is written once when a player goes offline.
* A report copies the last 20 messages into itself, so evidence survives the clean-up.
* Push subscriptions are encrypted in the database and delivered with Web Push/VAPID. Configure the same VAPID values and `PUSH_SUBSCRIPTION_SECRET` on both the website and realtime service. Browser/device support, HTTPS and the player's notification permission are required. Expired endpoints are removed.

## Tests

```
DATABASE_URL=... npm run test:chat                      # server, database, ticks, blocking, money, reports, retention
DATABASE_URL=... node tests/e2e/chatstore.e2e.mjs       # the browser-side store against the real server
```
Both need a database with the migrations applied. They create players named `e2e_*` / `es_*` and delete them afterwards.