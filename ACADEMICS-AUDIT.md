# Academics / school system audit

**Baseline commit:** `5f68de5a83321b3720f8e5c6d3bc830c032a0735` (origin/main, "redesign activity layer", fetched 2026-10-26).
Work started on `ceb7232`, then moved forward through `2e96083` to the baseline above; the academic logic was re-read after each move.
Apply by copying these files over the repo at the paths shown. No schema change, no migration.

## Bugs fixed (root cause -> fix)

1. **Skipping an exam cost nothing for a player who was online** (`lib/tick.js`). The "missed exam = automatic 0" row was only written for
   weeks `< current week` *inside the catch-up loop*, but the exam week itself had already been simulated (and `lastTickWeek` advanced) while the
   player was online in it, so the loop never revisited it. Sit exam 1 with an E, skip exam 2 and you got session mean 1.0 = pass. Now the week
   that just ended (`w-1`) is checked at the start of each simulated week, before the session is graded.
2. **Surprise tests could never be sat** (`lib/activityService.js`). The only code that resolves a PENDING `ClassTest` was behind a faculty
   screen that is no longer mounted, so every announced test became a "missed, counts as 0" test with its penalty. The class-test ring now
   resolves the announced test (must be that course, record -> TAKEN with score). Without one it is still a free practice test.
3. **Exam that outlives its week left the player stuck** (`lib/activityService.js`). Finishing after the week rolled over threw "no exam this
   week", rolled the whole finish back and left the run RUNNING. It now ends the run cleanly with an explanation.
4. **Graduates could keep sitting exams / attending / studying** (`gameService.js`, `courseService.js`, `activityService.js`), which would
   change a final, already-stored CGPA. Refused, and the rings show why.
5. **Duplicate exam request reported as success** (`lib/gameService.js`). A second exam request (new requestId) in the same week hit the unique key
   and came back as `{ok:true, duplicate:true}`. Now a clear 409; genuine replays of the same requestId still return `duplicate`.
6. **CGPA disagreed between screens after an expulsion restart** (`lib/leaderboards.js`, `lib/achievementService.js`, `lib/adminPlayers.js`).
   The game's own CGPA only counts results since `restartWeek`; the leaderboard, achievements and admin view averaged *all* results.
7. **`POST /api/courses` bypassed the "be at the ring" rule** (`src/app/api/courses/route.js`): attend/study from anywhere by hand-made request.
   It now returns 409 with guidance, like `/api/exam` already did. The service function is unchanged.
8. **Wrong / misleading text** (`components/apps/CoursesApp.js`, `components/GameHome.js`): "sit it on the game screen" and "examination hall of
   your own faculty" (exams are sat at the exam ring of a faculty building or any lecture theatre); Attend/Study buttons showed "done this week"
   and were disabled although the building rings allow repeats.

## Verified correct, unchanged
Score->grade point boundaries (70/60/50/45/40), CGPA rounding, degree classes (4.5/3.5/2.4/1.5/1.0), advance/repeat/withdraw/graduate rules,
once-per-week attendance counting with free repeats, exam idempotency, exam score = mean of per-course marks.

## Observed, NOT changed (need your decision)
- **No assignments, resits or course units exist** in this codebase. "Resit" = repeating the level; every course weighs the same; an exam's
  grade point is `gradePoint(mean score)`, not a mean of per-course grade points (storing fractional GPs would need `ExamResult.gradePoint` to
  become a float: a migration and a rules change).
- `components/PlacePanels.js` `FacultyPanel`/`panelFor` is dead code (never imported); its exam button would call `/api/exam`, which always 409s.
- Medicine/Pharmacy-length degrees: everyone graduates after 500L.

## Test / build results
- New `tests/academics.test.mjs`: 17 checks (grade points, CGPA, classes, closeSession, course scoring, missed exams via the real `catchUp`,
  restart handling, persistence, duplicate/graduate refusal). Verified to FAIL against the original `tick.js`.
- Extended `tests/tests__activities.test.mjs` (surprise test, graduate, exam-outlives-week); `activity-sweep` fixture gained the `classTest` table.
- Full `npm test` on the final tree: 84 files pass. Failing: `admin-console` (needs generated Prisma client; engine download blocked in sandbox),
  `developer-app`, `invest-screen`, `rides`, `room-size`, `sug-schedule` (all fail identically on the untouched baseline, unrelated areas),
  and `hustle` (pre-existing flaky: asserts a random catch occurs in 80 trials; passed 15/15 reruns, also on pristine).
- Production build: `next build` **could not be completed here**. Fonts (Google) are unreachable and `prisma generate` cannot download its
  engine. With the font import stubbed temporarily (not shipped) the compile stage reported "Compiled successfully", then stopped at
  "collect page data" because `.prisma/client` is not generated. Please run `npm run build` in your environment.
- Not run against real Postgres: the new `$queryRaw` in the CGPA leaderboard and the admin query were only syntax-checked.
