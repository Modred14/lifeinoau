# Faculty Groups

Every player belongs to exactly one **faculty group**, the group of the faculty they chose when they created their character. The group is a community inside the phone (the **Faculty** app): who is in it, a searchable member directory, each colleague's profile, private chats with colleagues, and the faculty's elections.

## How it is built, and what it reuses

| Need | Where it lives |
| --- | --- |
| Groups and membership | `FacultyGroup`, `FacultyGroupMember` (migration `20261121000000_faculty_groups`) |
| Private messages | **The existing chat system** (`Chat`, `Message`, `lib/chatCore.js`, the realtime server, the Messages app). No second chat system. |
| Faculty Representative and Assistant | **The existing SUG election** (`FACULTY_REP_<facultyId>` and `ASST_FACULTY_REP_<facultyId>` races, `lib/sugService.js`). No second election system. |
| Profiles | `getProfile` in `lib/gameService.js`, trimmed to public fields |
| Online status | The realtime server's `online` query when `REALTIME_URL` is set, otherwise "active in the last 3 minutes" (`User.lastActiveAt`) |

## Membership (automatic, enforced by the database)

* Every `Faculty` row gets its one group the moment it exists (trigger `faculty_group_for_new_faculty`). `FacultyGroup.facultyId` is unique, so a faculty cannot have two.
* Every `Character` is put in the group of its faculty when it is created, and moved if its faculty ever changes (trigger `faculty_group_sync_member`). `FacultyGroupMember.characterId` is unique, so a player cannot be in two groups, whatever a request says.
* The same migration **backfills** every existing faculty and player. It is idempotent and only adds rows. It never changes a player.
* Because these are database triggers, no code path (sign-up, an admin tool, a script, a future feature) can forget to do it.
* `Character.facultyId` is `NOT NULL` with a foreign key, so a player with a missing or invalid faculty cannot exist. If a membership row were ever missing, the next request repairs it (`myGroup` in `lib/facultyGroupService.js`).
* Check it any time: `node --env-file=.env scripts/faculty-groups-check.mjs` (read only; exit 1 on a problem; the script prints the safe repair).

## Who may see or message whom

Every function re-derives "same faculty" on the server from `Character.facultyId`; nothing the browser sends decides it.

* **Directory / profile**: only players of the caller's own faculty. Someone outside it, or a name that does not exist, is the same `404`, so nothing about them is revealed. Archived accounts are neither listed nor counted. Responses never contain an email, a password hash, or money.
* **Conversation** (`POST /api/faculty-groups/conversation`): refused unless the target is a colleague (404), not yourself (400), and not blocked either way (403). It finds or creates the one `Chat` row of the pair, so two players (or two simultaneous taps) always share one conversation. The browser then opens the normal Messages app on that name.

## Faculty elections

A faculty's two posts are races of the SUG election, so everything below is the SUG election's own, already tested behaviour: nominations (`register`) and votes (`vote`) are restricted to that faculty's students, one ballot per voter per race is a unique database key, ties go to a runoff, results are written once, and ballots are append-only. Administrators run it with the existing SUG admin tools.

The Faculty app only **reads** it for the caller's own faculty (`GET /api/faculty-groups/elections`): the stage and countdown, the two races with their candidates, results, and who holds each post now (an appointment counts only while its term contains the current time). A vote from the Faculty app is sent to the SUG election's own `POST /api/sug` `vote` action. Registering to stand opens the SUG app (it needs the nomination fee, slogan and manifesto).

## Real time

The app refreshes while it is open (every 15 to 20 seconds, and straight away when the chat connection reports a new unread message). Private messages themselves are delivered live by the existing realtime server. There is no new socket event for member counts, election status or results; that keeps this compatible with Vercel and needs no new realtime code.

## Tests

* `tests/faculty-groups.test.mjs`: pure helpers (runs in `npm test`).
* `tests/faculty-groups.e2e.mjs`: services against a real Postgres (membership, triggers, directory, chats, SUG faculty races, offices). Use a **disposable** database: it casts real SUG ballots, which the database keeps forever.
* `tests/faculty-groups.routes.e2e.mjs`: the real route handlers (login required, status codes, nothing sensitive, rate limits).

Run an e2e as `DATABASE_URL=... node tests/faculty-groups.e2e.mjs` (migrations applied). See the header of each file.
