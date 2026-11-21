// tests/occupancy.test.mjs: the building head count rules (lib/occupancy.js), with no database and no sockets.
import assert from "node:assert/strict";
import { createOccupancy, OCCUPANCY_TTL_MS } from "../lib/occupancy.js";

const ok = (m) => console.log("OK  ", m);
let t = 1_000_000; const clock = () => t;
const fresh = (o = {}) => createOccupancy({ now: clock, ...o });

// 4-7. enter, three inside, one leaves, everybody leaves
{
  const o = fresh();
  assert.deepEqual(o.claim("ada", "s1", "oduduwa"), { oduduwa: 1 }); assert.equal(o.count("oduduwa"), 1);
  assert.deepEqual(o.claim("bola", "s2", "oduduwa"), { oduduwa: 2 });
  assert.deepEqual(o.claim("chi", "s3", "oduduwa"), { oduduwa: 3 }); assert.deepEqual(o.snapshot(), { oduduwa: 3 });
  assert.deepEqual(o.release("bola", "s2"), { oduduwa: 2 });
  assert.deepEqual(o.release("ada", "s1"), { oduduwa: 1 });
  assert.deepEqual(o.release("chi", "s3"), { oduduwa: 0 }); // the change says 0 so the browser hides it...
  assert.deepEqual(o.snapshot(), {}); assert.equal(o.inside, 0); // ...and a snapshot never lists a building with nobody in it
  ok("1 -> 3 inside -> 2 -> 0: counts follow, and an empty building is not in the snapshot at all");
}

// a player is counted once: the same claim twice, and two tabs in the same building
{
  const o = fresh();
  o.claim("ada", "s1", "h_awo");
  assert.deepEqual(o.claim("ada", "s1", "h_awo"), {}); assert.equal(o.count("h_awo"), 1);
  assert.deepEqual(o.claim("ada", "s2", "h_awo"), {}); assert.equal(o.count("h_awo"), 1);
  assert.deepEqual(o.release("ada", "s1"), {}); assert.equal(o.count("h_awo"), 1); // the second tab still has her inside
  assert.deepEqual(o.release("ada", "s2"), { h_awo: 0 });
  ok("the same player is never counted twice (repeated claim, second tab), and only goes when her last connection does");
}

// 9. moving straight from one building to another: one off, one on, in a single step
{
  const o = fresh();
  o.claim("ada", "s1", "senate"); o.claim("bola", "s2", "senate");
  assert.deepEqual(o.claim("ada", "s1", "sub"), { senate: 1, sub: 1 });
  assert.equal(o.count("senate"), 1); assert.equal(o.count("sub"), 1); assert.equal(o.placeOf("ada"), "sub");
  assert.deepEqual(o.claim("bola", "s2", "sub"), { senate: 0, sub: 2 });
  assert.deepEqual(o.snapshot(), { sub: 2 });
  ok("moving directly between buildings takes one off the old and puts one on the new at once");
}

// a player with two tabs open in two buildings is in ONE place (the newest claim), never both
{
  const o = fresh();
  o.claim("ada", "tab1", "senate"); t += 5; o.claim("ada", "tab2", "sub");
  assert.equal(o.inside, 1); assert.deepEqual(o.snapshot(), { sub: 1 });
  assert.deepEqual(o.release("ada", "tab2"), { sub: 0, senate: 1 }); // the other tab still says senate
  ok("two tabs in two buildings: counted in exactly one (the newest), and falls back to the other when it closes");
}

// 8. a connection that goes silent is cleared by the sweep; one that keeps reporting is not
{
  const o = fresh({ ttlMs: 60_000 });
  o.claim("ada", "s1", "senate"); o.claim("bola", "s2", "senate");
  t += 40_000; assert.equal(o.beat("bola", "s2"), true); assert.deepEqual(o.sweep(), {});
  t += 30_000; // ada: 70 s of silence, bola: 30 s
  assert.deepEqual(o.sweep(), { senate: 1 }); assert.equal(o.beat("ada", "s1"), false); assert.equal(o.placeOf("ada"), null);
  t += 61_000; assert.deepEqual(o.sweep(), { senate: 0 }); assert.equal(o.inside, 0);
  ok("silent connections are swept after the time limit; a connection that keeps reporting stays; a forgotten one is told so (beat is false)");
}
assert.ok(OCCUPANCY_TTL_MS > 20_000 * 3, "the browser reports every 20 s: the limit allows several missed reports");

// robustness: unknown players, double release, many connections, big bursts
{
  const o = fresh();
  assert.deepEqual(o.release("ghost", "x"), {}); assert.equal(o.beat("ghost", "x"), false);
  o.claim("ada", "s1", "senate"); o.release("ada", "s1"); assert.deepEqual(o.release("ada", "s1"), {});
  for (let i = 0; i < 50; i++) o.claim("ada", "c" + i, "senate"); assert.equal(o.count("senate"), 1); // however many connections, still one player
  const o2 = fresh(); for (let i = 0; i < 1000; i++) o2.claim("p" + i, "s" + i, "bld_" + (i % 10));
  assert.equal(o2.inside, 1000); assert.equal(Object.values(o2.snapshot()).reduce((a, b) => a + b, 0), 1000);
  for (let i = 0; i < 1000; i++) o2.release("p" + i, "s" + i); assert.deepEqual(o2.snapshot(), {}); assert.equal(o2.inside, 0);
  ok("releasing someone unknown or twice does nothing; 1000 players across 10 buildings add up exactly and all come back to zero");
}
console.log("DONE");
