-- Scratch fixtures for exercising the admin console's SQL against a real Postgres.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP EXECUTE format('TRUNCATE %I RESTART IDENTITY CASCADE', t); END LOOP;
END $$;
INSERT INTO "Faculty"(name) VALUES ('Technology'),('Science'),('Law');
INSERT INTO "Account"(id, kind, "systemName", balance) VALUES ('sys_world','SYSTEM','WORLD',0),('sys_biz','SYSTEM','BUSINESS',0),('sys_dsa','SYSTEM','DSA',0);
-- 40 users; the first 36 have characters; ages spread over 120 days
DO $$
DECLARE i int; uid text; cid text; st text; cls text; bal bigint;
BEGIN
  FOR i IN 1..40 LOOP
    uid := 'u' || lpad(i::text, 4, '0'); cid := 'c' || lpad(i::text, 4, '0');
    st := CASE WHEN i = 7 THEN 'SUSPENDED' WHEN i = 8 THEN 'DELETED' ELSE 'ACTIVE' END;
    INSERT INTO "User"(id, email, "passwordHash", "isAdult", role, "createdAt", status, "statusReason", "statusUntil", "lastLoginAt", "lastActiveAt", "loginCount")
    VALUES (uid, 'player' || i || '@example.com', 'x', true, CASE WHEN i = 1 THEN 'ADMIN' ELSE 'PLAYER' END, (now() AT TIME ZONE 'UTC') - ((120 - i * 3) || ' days')::interval, st,
      CASE WHEN i = 7 THEN 'spamming chat' END, CASE WHEN i = 7 THEN (now() AT TIME ZONE 'UTC') + interval '2 days' END,
      CASE WHEN i <= 30 THEN (now() AT TIME ZONE 'UTC') - (i * 3 || ' days')::interval END,
      CASE WHEN i IN (2,3) THEN (now() AT TIME ZONE 'UTC') - interval '30 seconds' WHEN i = 4 THEN (now() AT TIME ZONE 'UTC') - interval '10 minutes' WHEN i = 5 THEN (now() AT TIME ZONE 'UTC') - interval '2 minutes' WHEN i <= 20 THEN (now() AT TIME ZONE 'UTC') - (i || ' days')::interval END,
      i % 6);
    IF i <= 36 THEN
      cls := (ARRAY['NEPO','MAPO','LAPO'])[1 + i % 3];
      INSERT INTO "Character"(id, "userId", name, gender, class, "facultyId", luck, "riskTolerance", level, "createdAt", "placeId", "placeAt", "hideFromForbes", "jailedUntil")
      VALUES (cid, uid, 'Player' || i, (CASE WHEN i % 2 = 0 THEN 'F' ELSE 'M' END)::"Gender", cls::"Class", 1 + i % 3, 50, 50, 100 * (1 + i % 4), (now() AT TIME ZONE 'UTC') - ((120 - i * 3) || ' days')::interval,
        CASE WHEN i IN (2, 6) THEN 'h_awo' ELSE '' END, CASE WHEN i = 2 THEN (now() AT TIME ZONE 'UTC') - interval '20 seconds' WHEN i = 6 THEN (now() AT TIME ZONE 'UTC') - interval '5 minutes' END, i = 9,
        CASE WHEN i = 11 THEN (now() AT TIME ZONE 'UTC') + interval '1 hour' END);
      bal := CASE WHEN i = 3 THEN 987654321012345678 WHEN i = 12 THEN 25000000000 ELSE (i * 7919 * 100)::bigint END;
      INSERT INTO "Account"(id, kind, "characterId", balance) VALUES ('a' || cid, 'PLAYER', cid, bal);
      INSERT INTO "LedgerEntry"("idempotencyKey", "debitAccountId", "creditAccountId", amount, memo, "gameWeek", "createdAt")
      VALUES ('seed:' || cid, 'sys_world', 'a' || cid, bal, 'Starting allowance', 1, (now() AT TIME ZONE 'UTC') - interval '3 days');
    END IF;
  END LOOP;
END $$;
INSERT INTO "Business"("characterId", type, name, capital, status, "startedWeek", "lastWeek") VALUES ('c0002','POS','Bola Mart', 5000000, 'ACTIVE', 1, 1), ('c0012','POS','Big Store', 100000000, 'ACTIVE', 1, 1);
INSERT INTO "ActionLog"("characterId","requestId",action,"gameWeek","createdAt") SELECT 'c' || lpad(((g % 20) + 1)::text, 4, '0'), 'r' || g, 'eat', 1, (now() AT TIME ZONE 'UTC') - ((g % 30) || ' days')::interval FROM generate_series(1, 300) g;
INSERT INTO "AuditLog"("actorId", action, target, detail, status, "requestId", error) VALUES ('u0001','MONEY:credit','c0002','{"amountKobo":"100"}','OK','req-aaaaaaaa',NULL), ('u0001','MONEY:debit','c0003','{}','FAILED','req-bbbbbbbb','Player only has ₦5');
