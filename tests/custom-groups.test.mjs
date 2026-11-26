// tests/custom-groups.test.mjs: names and roles of player-made groups (no database). The database-backed checks are in custom-groups.e2e.mjs.
import assert from "node:assert/strict";
import { checkName, cleanDescription, permissions, mayRemove, LIMITS } from "../lib/customGroupRules.js";
let n = 0; const t = (name, fn) => { fn(); n++; };
t("names are trimmed, squeezed and length checked", () => {
  assert.equal(checkName("  Chess   Club ").name, "Chess Club");
  for (const bad of ["", "ab", "x".repeat(41), "<script>", "!!!", null]) assert.ok(checkName(bad).error, String(bad));
});
t("a custom group cannot pose as an official one", () => {
  for (const bad of ["Faculty of Law", "law faculty group", "Law  Faculty-Group", "Official OAU News", "Technology Faculty Group"]) assert.ok(checkName(bad).error, bad);
  assert.equal(checkName("Law Study Circle").error, undefined);
});
t("descriptions are cut to the limit", () => assert.equal(cleanDescription("a".repeat(500)).length, LIMITS.descMax));
t("a regular member and an outsider manage nothing", () => {
  for (const role of ["MEMBER", null]) for (const [k, v] of Object.entries(permissions(role))) if (k !== "leave") assert.equal(v, false, `${role} ${k}`);
});
t("owner only: delete, roles, transfer, privacy", () => {
  for (const k of ["destroy", "changeRoles", "transfer", "changePrivacy"]) { assert.equal(permissions("OWNER")[k], true); assert.equal(permissions("ADMIN")[k], false); }
  assert.equal(permissions("ADMIN").edit, true); assert.equal(permissions("ADMIN").invite, true);
});
t("who may remove whom", () => {
  assert.ok(mayRemove("OWNER", "ADMIN") && mayRemove("OWNER", "MEMBER") && mayRemove("ADMIN", "MEMBER"));
  for (const [a, b] of [["OWNER", "OWNER"], ["ADMIN", "ADMIN"], ["ADMIN", "OWNER"], ["MEMBER", "MEMBER"], [null, "MEMBER"]]) assert.equal(mayRemove(a, b), false, `${a} ${b}`);
});
console.log(`custom-groups: ${n} checks passed`);
