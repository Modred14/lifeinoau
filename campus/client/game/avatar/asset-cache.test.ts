import assert from "node:assert/strict";
import { test } from "node:test";
import { SharedAssetCache } from "./asset-cache";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("concurrent students share downloads and keep geometry alive until every lease closes", async () => {
  let loads = 0, disposed = 0;
  const cache = new SharedAssetCache(async (key) => ({ key, id: ++loads }), () => disposed++, 1, 2);
  const [a, b, c] = await Promise.all([cache.acquire("scrubs"), cache.acquire("scrubs"), cache.acquire("scrubs")]);
  assert.equal(loads, 1); assert.equal(a.value, b.value); assert.equal(b.value, c.value);
  a.release(); a.release(); b.release();
  const next = await cache.acquire("coat");
  assert.equal(disposed, 0);
  assert.equal(cache.stats.leased, 2);
  c.release();
  assert.equal(disposed, 1); assert.equal(cache.stats.cached, 1);
  next.release();
});

test("a crowded campus limits active downloads and queued work drains without losing requests", async () => {
  const pending: Array<{ key: string; resolve: (value: string) => void }> = [];
  const removed: string[] = [];
  const cache = new SharedAssetCache((key) => new Promise<string>((resolve) => pending.push({ key, resolve })), (value) => removed.push(value), 4, 3);
  const requests = Array.from({ length: 30 }, (_, i) => cache.acquire(`student-part-${i}`));
  await flush();
  assert.equal(pending.length, 3); assert.equal(cache.stats.loading, 3); assert.equal(cache.stats.queued, 27);
  for (let completed = 0; completed < 30;) {
    const batch = pending.splice(0);
    assert.ok(batch.length > 0 && batch.length <= 3);
    for (const item of batch) item.resolve(item.key);
    completed += batch.length;
    await flush();
    assert.ok(cache.stats.loading <= 3);
  }
  const leases = await Promise.all(requests);
  assert.equal(new Set(leases.map((lease) => lease.value)).size, 30);
  assert.equal(removed.length, 0);
  leases.forEach((lease) => lease.release());
  assert.equal(cache.stats.cached, 4); assert.equal(cache.stats.leased, 0);
  assert.equal(cache.stats.loading, 0); assert.equal(cache.stats.queued, 0);
  assert.equal(removed.length, 26);
});

test("idle eviction preserves active avatars and recently reused parts", async () => {
  const removed: string[] = [];
  const cache = new SharedAssetCache(async (key) => ({ key }), (value) => removed.push(value.key), 2, 1);
  const active = await cache.acquire("active");
  const older = await cache.acquire("older"); older.release();
  const recent = await cache.acquire("recent"); recent.release();
  assert.deepEqual(removed, ["older"]);
  const same = await cache.acquire("active"); assert.equal(same.value, active.value);
  same.release();
  const newPart = await cache.acquire("new");
  assert.deepEqual(removed, ["older", "recent"]);
  assert.equal(cache.stats.cached, 2);
  newPart.release(); active.release();
});

test("failed downloads reject every waiter, release a queue slot and allow a fresh retry", async () => {
  let attempts = 0;
  const cache = new SharedAssetCache(async (key) => {
    if (key === "retry" && ++attempts === 1) throw new Error("Connection lost");
    return key;
  }, () => {}, 2, 1);
  const failed = [cache.acquire("retry"), cache.acquire("retry")];
  const following = cache.acquire("following");
  const results = await Promise.allSettled(failed);
  assert.ok(results.every((result) => result.status === "rejected"));
  const queued = await following; assert.equal(queued.value, "following"); queued.release();
  const retry = await cache.acquire("retry"); assert.equal(retry.value, "retry"); assert.equal(attempts, 2);
  retry.release(); await flush();
  assert.equal(cache.stats.leased, 0); assert.equal(cache.stats.loading, 0);
  assert.throws(() => new SharedAssetCache(async () => "", () => {}, 0, 1), /positive integers/);
});

test("invalidating a damaged source permits retry while existing students retain their geometry", async () => {
  let version = 0;
  const disposed: number[] = [];
  const cache = new SharedAssetCache(async (key) => ({ key, version: ++version }), (value) => disposed.push(value.version), 2, 1);
  const first = await cache.acquire("coat"), shared = await cache.acquire("coat");
  cache.invalidate("coat");
  assert.equal(disposed.length, 0);
  const repaired = await cache.acquire("coat");
  assert.notEqual(first.value, repaired.value);
  first.release(); first.release();
  assert.equal(disposed.length, 0);
  shared.release();
  assert.deepEqual(disposed, [1]);
  const stillRepaired = await cache.acquire("coat");
  assert.equal(stillRepaired.value, repaired.value);
  stillRepaired.release(); repaired.release();
  cache.invalidate("coat");
  assert.deepEqual(disposed, [1, 2]);
});
