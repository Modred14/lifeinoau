#!/bin/sh
# Database tests for the administrator console, against a real Postgres (not fakes): exact uncapped money, atomic and duplicate-safe changes, Forbes exclusion,
# account archiving, presence, audit and notices.
#   createdb lifeinoau_test && DATABASE_URL=postgresql://localhost:5432/lifeinoau_test npx prisma migrate deploy
#   DATABASE_URL=postgresql://localhost:5432/lifeinoau_test sh tests/pg/admin/run.sh
# Every suite reloads fixtures.sql first, which TRUNCATES the game tables. Never point this at real data (db.mjs refuses anything but a local *_test / *_dev database).
set -e
cd "$(dirname "$0")/../../.."
for t in tests/pg/admin/t*.pg.mjs; do
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/pg/admin/fixtures.sql >/dev/null
  psql "$DATABASE_URL" -q -c "INSERT INTO \"GameClock\"(id, \"startedAt\", \"campusEpoch\", \"campusStartWeek\") VALUES (1, (now() AT TIME ZONE 'UTC') - interval '20 days', (now() AT TIME ZONE 'UTC') - interval '20 days', 1)" -c "DELETE FROM \"Account\" WHERE \"systemName\"='GAMES'" >/dev/null
  psql "$DATABASE_URL" -q -c "INSERT INTO \"LedgerEntry\"(\"idempotencyKey\", \"debitAccountId\", \"creditAccountId\", amount, memo, \"gameWeek\", \"createdAt\") SELECT 'fx:bizpool', 'sys_world', 'sys_biz', COALESCE(SUM(capital),0), 'fixture: business capital', 1, now() AT TIME ZONE 'UTC' FROM \"Business\" WHERE status='ACTIVE'" -c "UPDATE \"Account\" SET balance = balance - (SELECT COALESCE(SUM(capital),0) FROM \"Business\" WHERE status='ACTIVE') WHERE \"systemName\"='WORLD'" -c "UPDATE \"Account\" SET balance = (SELECT COALESCE(SUM(capital),0) FROM \"Business\" WHERE status='ACTIVE') WHERE \"systemName\"='BUSINESS'" >/dev/null
  echo "== $t"; node "$t"
done
