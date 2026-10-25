# Life in OAU: performance pass

**Baseline commit:** `ceb7232d75ab48bd1ba72bac62f03808e73120f7` ("add bank app and phone app")

## What I found
The code at this commit already does much of what was asked: an optimistic store with per-change rollback (`lib/optimistic.js`),
idempotent retried requests (`lib/http.js`), a request-coalescing server cache (`lib/cache.js`), an in-memory limiter for non-sensitive routes,
guarded polling (hidden-tab checks), and indexes on the presence queries (`Character(placeId, placeAt)`, `Character(tripAt)`).
I did not rewrite those. I changed only the gaps I could confirm by reading the code.

## Changes
| File | Change | Effect |
|---|---|---|
| `lib/http.js` | Identical GETs in flight share one request. Reads with their own `signal` / `timeout` / `retries` are never shared. Any write starts a new read generation, so a read issued after a write can never join a read that left before it. | Fewer duplicate `/api/state`, `/api/room`, etc. when several screens or a poll plus a focus refresh fire together. Money/idempotency paths are untouched. |
| `lib3d/perfGovernor.js` (new) + `lib3d/stage.js` | Adaptive render resolution: sustained slow frames lower the pixel ratio in 0.25 steps (floor 0.75); a long fast spell raises it again; cool-down prevents flicker; stalled frames (hidden tab) are ignored. | Weak phones trade a little sharpness for smooth frames. Gameplay, physics and timing do not depend on it. Applies to the map, room, garage and character viewer. |
| `lib3d/stage.js` | `dispose()` now frees materials and their textures (previously only geometries) and calls `forceContextLoss()`. | No GPU memory left behind per screen visit; avoids hitting the browser's live-WebGL-context limit when moving between map, room and garage. |
| `components/CampusMap.js` | Name tags are re-projected only when the camera moved or the box resized (plus 30 settle frames). | Zero label work while the map is idle. |
| `public/sw.js` | Stale-while-revalidate for `/data/*` (campus + road graph) and `/models/*` (avatars); cache bumped to `v5`. Only public static files; `/api/*` is never cached. | Repeat visits on slow networks load the map and avatars instantly and update silently. |
| `tests/http.test.mjs`, `tests/perf-governor.test.mjs` | New tests for the above. | |

## Verification
- `npm test`: **85 pass, 5 fail**. Baseline was 84 pass, 5 fail. The 5 failing files are the same before and after and are not touched by this change:
  `developer-app`, `invest-screen`, `rides`, `room-size`, `sug-schedule`.
- All changed files compile (esbuild bundle check, including the JSX in `CampusMap.js`).
- **Production build: not completed here.** The sandbox cannot reach `binaries.prisma.sh` (Prisma engines) or Google Fonts. `next build` fails identically on the untouched baseline (2 font fetch errors). Please run `npm run build` in your environment.

## Not done / limits (stated plainly)
- **No before/after browser profiling.** There is no GPU or real device in this sandbox, so I could not measure frame times, and I make no numeric FPS claims. The resolution governor is verified in Node only; its thresholds (`slowMs 25`, `fastMs 15`) should be tuned on a real low-end phone.
- Not changed: server queries, schema/indexes, matchmaking, banking, betting, rewards, ownership (already server-validated; no confirmed bottleneck found without a database to profile).
- Not added: persisted (localStorage) copies of player state, inventory or finances. Doing that safely needs per-account keying and logout wiping, and I did not want to ship it unprofiled.
- Not touched: per-frame logic in `lib3d/room.js`, `interiors/scene.js`, `character.js`, traffic and pathfinding. Worth profiling with Chrome's Performance panel before changing.
