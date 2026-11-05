import assert from "node:assert/strict";
import { compactNumber, compactMoney, compactKobo } from "../lib/money.js";
const cases = [[0,"0"],[800,"800"],[999,"999"],[1000,"1.00k"],[1200,"1.20k"],[7820,"7.82k"],[12500,"12.5k"],[99950,"100k"],[100000,"100k"],[999999,"1.00M"],[1000000,"1.00M"],[8430000,"8.43M"],[1250000000,"1.25B"],[2500000000000,"2.50T"],[-7820,"-7.82k"],[-800,"-800"],[1234567890123456n,"1,230T"],["8430000","8.43M"],[0.1+0.2,"0"]];
for (const [i, o] of cases) assert.equal(compactNumber(i), o, `${i}`);
assert.equal(compactMoney(-1200), "-₦1.20k");
assert.equal(compactKobo(782000n), "₦7.82k");
assert.equal(compactKobo(99999n), "₦999");
console.log("money.test ok");
assert.equal((await import("../lib/money.js")).exactKobo(123400n), "₦1,234"); console.log("exact ok");
