// tests/faculty-groups.test.mjs: the pure helpers of faculty groups (no database). The database-backed checks are in faculty-groups.e2e.mjs.
import assert from "node:assert/strict";
import * as R from "../lib/facultyGroupRules.js";
import { FACULTIES } from "../lib/faculties.js";
import { facultyPositionKey, facultyPositionKeys, positionOf, mayVoteIn } from "../lib/sugRules.js";

let n = 0; const t = (name, fn) => { fn(); n++; };

t("group names are built from the faculty name", () => {
  assert.equal(R.groupName("Faculty of Technology"), "Technology Faculty Group");
  assert.equal(R.groupName("Faculty of Environmental Design and Management"), "Environmental Design and Management Faculty Group");
  assert.equal(R.groupName("Faculty of Computing Science & Engineering"), "Computing Science & Engineering Faculty Group");
});
t("every faculty the game supports gets a distinct group name (so one group each)", () => {
  const names = FACULTIES.map(([f]) => R.groupName(f));
  assert.equal(FACULTIES.length, 15); assert.equal(new Set(names).size, 15);
});
t("a typed % or _ in a search is escaped so it is matched literally", () => {
  assert.equal(R.likeEscape("50%_off\\"), "50\\%\\_off\\\\");
  assert.equal(R.likeEscape("plain"), "plain"); assert.equal(R.likeEscape(null), "");
});
// The faculty posts are the SUG election's (lib/sugRules.js). These checks pin the contract Faculty Groups relies on.
t("each faculty has exactly two SUG posts, and they belong only to that faculty", () => {
  const [rep, asst] = facultyPositionKeys(7);
  assert.equal(rep, "FACULTY_REP_7"); assert.equal(asst, "ASST_FACULTY_REP_7"); assert.equal(facultyPositionKey(7, true), asst);
  assert.equal(positionOf(rep).title, "Faculty Representative"); assert.equal(positionOf(asst).title, "Assistant Faculty Representative");
  assert.equal(positionOf(rep).facultyId, 7);
});
t("only students of that faculty may vote in its races", () => {
  assert.equal(mayVoteIn("FACULTY_REP_7", { facultyId: 7 }), true);
  assert.equal(mayVoteIn("ASST_FACULTY_REP_7", { facultyId: 7 }), true);
  assert.equal(mayVoteIn("FACULTY_REP_7", { facultyId: 8 }), false);
  assert.equal(mayVoteIn("FACULTY_REP_7", null), false);
});
console.log(`faculty-groups: ${n} checks passed`);
