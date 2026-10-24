// tests/forbes-format.test.mjs
import assert from "node:assert/strict";
import { compactNaira, wealthShares, podiumSlots, sameName } from "../lib/forbesFormat.js";
import { getBoard, clearBoardCache } from "../lib/leaderboards.js";

assert.equal(compactNaira("1200000000000000"), "₦12tn");
assert.equal(compactNaira("120000000000000"), "₦1.2tn");
assert.equal(compactNaira("10000000000000"), "₦100bn");
assert.equal(compactNaira("34050000000000"), "₦340.5bn");
assert.equal(compactNaira("99999999999"), "₦999.9m"); // rounds down, never up to 1,000m
assert.equal(compactNaira("4500000"), "₦45,000");
assert.equal(compactNaira("0"), "₦0");
assert.equal(compactNaira("nonsense"), "₦0");
assert.equal(compactNaira(null), "₦0");
assert.equal(compactNaira("-250000000"), "-₦2.5m");

const s = wealthShares({ cash: "7500", business: "2500", investments: "0" });
assert.deepEqual(s.map((x) => x.pct), [75, 25, 0]);
assert.equal(wealthShares({ cash: "0", business: "0", investments: "0" }), null);
assert.equal(wealthShares({}), null);
assert.equal(wealthShares({ cash: "-500", business: "1000", investments: "0" })[1].pct, 100); // a negative balance is not drawn

const rows = [{ name: "a", rank: 1 }, { name: "b", rank: 2 }, { name: "c", rank: 2 }, { name: "d", rank: 4 }];
assert.deepEqual(podiumSlots(rows).map((x) => x.row.name), ["b", "a", "c"]);
assert.deepEqual(podiumSlots(rows).map((x) => x.place), [2, 1, 3]);
assert.deepEqual(podiumSlots([rows[0]]).map((x) => x && x.row.name), [null, "a", null]);
assert.deepEqual(podiumSlots([]), [null, null, null]);
assert.ok(sameName(" Ada ", "ada") && !sameName("Ada", "") && !sameName(undefined, "ada"));

// The board's data rules are untouched by the redesign: admin-hidden players stay off, and the order is net worth, then name.
let sql = "";
clearBoardCache();
const db = { $queryRaw: async (strings) => { sql = strings.join("?"); return []; } };
const b = await getBoard(db, "forbes", 5_000_000);
assert.ok(sql.includes('NOT c."hideFromForbes"') && sql.includes("ORDER BY t.nwn DESC, t.name ASC") && sql.includes("kind = 'PLAYER'"));
assert.ok(sql.includes("u.status <> 'DELETED'"), "archived accounts are never listed");
assert.ok(sql.includes("::numeric") && !sql.includes("::bigint"), "net worth is summed as NUMERIC so a huge administrative grant cannot overflow the board");
assert.deepEqual(b.rows, []);
console.log("forbes format and board rules: ok");
