// tests/run-all.mjs
// Runs every test file and reports pass/fail. Usage: npm test
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
let failed = 0;
for (const f of readdirSync(new URL(".", import.meta.url)).filter((x) => x.endsWith(".test.mjs")).sort()) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(f, import.meta.url))], { encoding: "utf8" });
  const ok = r.status === 0; if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f}`); if (!ok) console.log(r.stderr.split("\n").slice(0, 6).join("\n"));
}
console.log(failed ? `\n${failed} test file(s) failed` : "\nAll test files ran without errors");
process.exit(failed ? 1 : 0);
