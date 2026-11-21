# Building occupancy ("3 people inside")

Every building on the map shows how many **real** players are inside it right now. A building with nobody inside shows **nothing** (no "0", no empty chip). There is no fake or random occupancy anywhere.

## What "inside" means

A player is inside a building while they have its interior open on the map page (`inside` in `src/app/map/page.js`), including open spaces the game opens the same way. Floor O (custody) is never counted. Rooms at home (`/home`) are not part of this feature.

## How it is tracked (server-authoritative)

* **State** lives in memory in the realtime server (`realtime/server.js`), in `lib/occupancy.js`: a claim is "this connection of this player is inside building X". Nothing is written to the database.
* **The browser only says where THIS player is** (`occ:in {place}`, `occ:out`, `occ:beat`) over the existing chat socket. It can never set a count.
* **The server validates** every `occ:in`: the player's identity is the verified chat pass, the id must have the shape of a place id, and the **database must say the player is standing there** (`Character.placeId`, or home when empty; not in custody). A player who has not travelled somewhere cannot be counted there.
* **One player, one building.** A player is counted in the place of their newest claim, once, however many tabs/connections. Moving straight from A to B is one `claim`: A drops by one and B rises by one in the same step.
* **Cleanup.** A closed tab or dropped connection is forgotten after a short grace period (`graceMs`, so a reload does not flicker the number). A connection that is open but stops reporting for 75 s (`OCCUPANCY_TTL_MS`; the browser reports every 20 s) is swept. Disconnects from an admin kick are handled the same way.
* **Simultaneity.** State changes are synchronous in one Node thread; a player's requests are queued (`occSerial`) so enter/leave are applied in the order sent.
* **Rate limited** per socket.

## How it is synchronised

* A map on screen asks once (`occ:sub`) and gets the non-zero counts, then receives **only what changed** (`occ:d`, absolute counts, 0 meaning "now empty"), merged into one message per 100 ms. Closing the map unsubscribes.
* After a reconnect the browser re-subscribes (fresh snapshot) and re-claims its building; after a realtime server restart (which forgets everything) this restores the true counts within seconds. If the connection stays down for 6 s the browser drops the numbers rather than show stale ones.
* Without the realtime server (`REALTIME_URL` unset) the feature simply shows nothing. It needs the realtime server and, like chat presence, **one** instance (state is in memory). For several instances, move `lib/occupancy.js` state to Redis with TTLs.

## UI

`components/OccupancyBadge.js`, inside each name tag in `components/CampusMap.js`, styled by `.bl .occ` in `globals.css`. It subscribes to one building's number, so a change redraws only that badge. A building with somebody inside keeps its name tag visible even when the map would thin it out, so the count can be read; the "Labels" button still hides everything.

## Rules a future change must keep

1. The browser never sets or sends a count, and the server never trusts a location without checking the database.
2. A player is counted at most once, in at most one building.
3. Every claim must end when its connection does (disconnect, grace, TTL sweep). Do not add a path that can leave a claim behind.
4. Zero is never shown: no "0", no empty indicator, no entry in snapshots or in the browser's store.
5. No simulated occupancy, ever.

## Tests

`tests/occupancy.test.mjs` (rules) and `tests/occupancy-realtime.test.mjs` (real sockets: enter/leave, 3 inside, moving, disconnect, reload, silent connection, refused claims, 25 simultaneous, restart) both run in `npm test`.
