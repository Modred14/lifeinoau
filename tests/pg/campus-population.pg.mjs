// tests/pg/campus-population.pg.mjs: the campus population (header number) against a REAL PostgreSQL database with every migration applied.
//   DATABASE_URL=postgresql://user:pass@localhost:5432/lifeinoau_test node tests/pg/campus-population.pg.mjs      (add PG_ADAPTER=1 if Prisma's engine cannot be downloaded)
// The checks themselves are in campus-population.body.mjs. Like the other tests in this folder it empties the game tables, so the harness refuses a database not named "*test*".
import { db, reset, player, ok, done } from "./bankHarness.mjs";
import { run } from "./campus-population.body.mjs";

await run({ db, reset, player, ok });
await done();
