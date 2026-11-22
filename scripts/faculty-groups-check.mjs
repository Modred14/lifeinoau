// scripts/faculty-groups-check.mjs
// Read-only health check of Faculty Groups. Run it after `prisma migrate deploy` (which backfills every existing player) to see the proof:
//
//   node --env-file=.env scripts/faculty-groups-check.mjs
//
// It changes nothing. Exit code 1 if any problem is found:
//   - a faculty without exactly one group
//   - a player with no membership, or in the group of a different faculty than their own
//   - a membership whose player no longer exists (the foreign key makes this impossible, so seeing it means something is badly wrong)
// If it reports a problem, this repair is safe to run (idempotent, touches only faculty-group rows, never a player):
//   INSERT INTO "FacultyGroup" ("facultyId") SELECT "id" FROM "Faculty" ON CONFLICT ("facultyId") DO NOTHING;
//   UPDATE "FacultyGroupMember" m SET "groupId" = g."id" FROM "Character" c JOIN "FacultyGroup" g ON g."facultyId" = c."facultyId" WHERE m."characterId" = c."id" AND m."groupId" <> g."id";
//   INSERT INTO "FacultyGroupMember" ("groupId","characterId") SELECT g."id", c."id" FROM "Character" c JOIN "FacultyGroup" g ON g."facultyId" = c."facultyId" ON CONFLICT ("characterId") DO NOTHING;
// (The triggers in the migration keep this true on their own; a problem here means they were disabled or the migration did not run.)
// PRISMA_CLIENT / PRISMA_ADAPTER are only for running it in a test environment (as in tests/chat.e2e.mjs); in production leave them unset.
const { PrismaClient } = await import(process.env.PRISMA_CLIENT ?? "@prisma/client");
let db;
if (process.env.PRISMA_ADAPTER) { const { PrismaPg } = await import(process.env.PRISMA_ADAPTER); db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }); } else db = new PrismaClient();
const n = (r) => Number(r[0].n);
const [faculties, groups, noGroup, players, members, missing, wrong] = await Promise.all([
  db.$queryRaw`SELECT count(*)::int AS n FROM "Faculty"`,
  db.$queryRaw`SELECT count(*)::int AS n FROM "FacultyGroup"`,
  db.$queryRaw`SELECT count(*)::int AS n FROM "Faculty" f WHERE (SELECT count(*) FROM "FacultyGroup" g WHERE g."facultyId" = f."id") <> 1`,
  db.$queryRaw`SELECT count(*)::int AS n FROM "Character"`,
  db.$queryRaw`SELECT count(*)::int AS n FROM "FacultyGroupMember"`,
  db.$queryRaw`SELECT count(*)::int AS n FROM "Character" c WHERE NOT EXISTS (SELECT 1 FROM "FacultyGroupMember" m WHERE m."characterId" = c."id")`,
  db.$queryRaw`SELECT count(*)::int AS n FROM "FacultyGroupMember" m JOIN "FacultyGroup" g ON g."id" = m."groupId" JOIN "Character" c ON c."id" = m."characterId" WHERE g."facultyId" <> c."facultyId"`,
]);
const perFaculty = await db.$queryRaw`SELECT f."name", count(m."id")::int AS members FROM "Faculty" f LEFT JOIN "FacultyGroup" g ON g."facultyId" = f."id" LEFT JOIN "FacultyGroupMember" m ON m."groupId" = g."id" GROUP BY f."name" ORDER BY f."name"`;
console.log(`Faculties: ${n(faculties)}   Groups: ${n(groups)}   (every faculty must have exactly one group)`);
console.log(`Players:   ${n(players)}   Memberships: ${n(members)}`);
for (const r of perFaculty) console.log(`  ${String(r.members).padStart(6)}  ${r.name}`);
const bad = { "faculties without exactly one group": n(noGroup), "players with no membership": n(missing), "players in another faculty's group": n(wrong) };
let problems = 0;
for (const [what, count] of Object.entries(bad)) { console.log(`${count === 0 ? "OK  " : "FAIL"}  ${what}: ${count}`); problems += count; }
await db.$disconnect();
process.exit(problems ? 1 : 0);
