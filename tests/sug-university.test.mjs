// tests/sug-university.test.mjs: university / faculty positions, their eligibility, and the campaign flyer renderer. No database.
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as R from "../lib/sugRules.js";
import { sniffImage, normalisePhoto } from "../lib/sugFlyer.js";
import { renderFlyer, flyerWords, COLORS } from "../lib/flyerRender.js";
let n = 0; const ok = (m) => console.log("OK  ", m, ++n && "");

// positions: SUG untouched, university separate, no duplicates, faculty keys encode the faculty
assert.equal(R.POSITIONS.length, 12); assert.equal(R.TOTAL_ELECTED_SEATS, 41);
const all = [...R.SUG_POSITION_KEYS, ...R.UNIVERSITY_POSITION_KEYS]; assert.equal(new Set(all).size, all.length);
for (const k of ["VICE_CHANCELLOR", "DEPUTY_VICE_CHANCELLOR", "DEAN_STUDENT_AFFAIRS", "REGISTRAR", "STUDENT_AFFAIRS_REP"]) assert.equal(R.categoryOf(k), "UNIVERSITY", k);
assert.equal(R.categoryOf("PRESIDENT"), "SUG"); assert.equal(R.categoryOf("FACULTY_REP_3"), "FACULTY"); assert.equal(R.positionOf("ASST_FACULTY_REP_3").facultyId, 3);
for (const bad of ["FACULTY_REP_0", "FACULTY_REP_", "FACULTY_REP_1x", "XFACULTY_REP_1", "ASST_ASST_FACULTY_REP_1", "faculty_rep_1", "FACULTY_REP_1234567890"]) assert.equal(R.positionOf(bad), null, bad);
ok("12 SUG posts are unchanged, 5 university posts are a separate category, and faculty post keys are strict");
// powers and money never leak to the new posts
for (const k of [...R.UNIVERSITY_POSITION_KEYS, "FACULTY_REP_1", "ASST_FACULTY_REP_1"]) assert.equal(R.stipendOf(k), null, `${k} has no stipend`);
assert.ok(R.stipendOf("PRESIDENT") && R.stipendOf("HONOURABLE_MEMBER") && R.stipendOf(R.CLERK)); assert.deepEqual(R.announceKindsFor(["VICE_CHANCELLOR", "FACULTY_REP_1"]), []);
ok("university and faculty posts carry no SUG stipend or announcement power");
// eligibility
const c = (level, facultyId) => ({ level, facultyId });
assert.equal(R.positionIssues("VICE_CHANCELLOR", c(400, 1)).length, 0); assert.equal(R.positionIssues("VICE_CHANCELLOR", c(300, 1)).length, 1);
assert.equal(R.positionIssues("DEPUTY_VICE_CHANCELLOR", c(300, 1)).length, 0); assert.equal(R.positionIssues("STUDENT_AFFAIRS_REP", c(100, 1)).length, 1); assert.equal(R.positionIssues("PRESIDENT", c(100, 1)).length, 0);
assert.equal(R.positionIssues("FACULTY_REP_2", c(100, 2)).length, 0); assert.equal(R.positionIssues("FACULTY_REP_2", c(500, 1)).length, 1); assert.equal(R.positionIssues("ASST_FACULTY_REP_2", c(100, 1)).length, 1);
assert.equal(R.mayVoteIn("FACULTY_REP_2", c(100, 1)), false); assert.equal(R.mayVoteIn("FACULTY_REP_2", c(100, 2)), true); assert.equal(R.mayVoteIn("VICE_CHANCELLOR", c(100, 9)), true);
assert.ok(R.eligibilityOf("VICE_CHANCELLOR").some((x) => /400 level/.test(x))); assert.ok(R.eligibilityOf("FACULTY_REP_2", "Faculty of Law").some((x) => /Faculty of Law/.test(x)));
ok("each category has its own eligibility rules, and faculty races belong to their faculty");
// races of a cycle
const specs = R.raceSpecs([1, 2, 3]); assert.equal(specs.length, 12 + 5 + 6); assert.equal(new Set(specs.map((x) => x.position)).size, specs.length); assert.equal(specs.filter((x) => x.seats > 1).length, 1);
ok("a cycle's races: 12 SUG + 5 university + 2 per faculty, one multi-seat race");
// flyer words are exactly the required message
const w = flyerWords({ username: "Modred14", positionTitle: "Vice-Chancellor" });
assert.equal(w.headline, "VOTE FOR @MODRED14 AS VICE-CHANCELLOR ON LIFEINOAU"); assert.equal(w.action, "VISIT LIFEINOAU.COM NOW TO VOTE");
ok("the flyer message and call to action are exactly as specified");
// image sniffing
const pic = (type, w2 = 800, h = 1000) => { const cv = createCanvas(w2, h); cv.getContext("2d").fillRect(0, 0, w2, h); return cv.encodeSync(type); };
assert.deepEqual(sniffImage(pic("jpeg")), { type: "jpeg", width: 800, height: 1000 }); assert.deepEqual(sniffImage(pic("png")), { type: "png", width: 800, height: 1000 }); assert.deepEqual(sniffImage(pic("webp")), { type: "webp", width: 800, height: 1000 });
assert.equal(sniffImage(Buffer.from("<svg></svg>".padEnd(40))), null); assert.equal(sniffImage(Buffer.from("GIF89a".padEnd(40))), null);
const norm = await normalisePhoto(pic("png", 3000, 2000)); assert.equal(sniffImage(norm.bytes).type, "jpeg"); assert.ok(norm.width === 1600 && norm.height === 1067);
ok("pictures are identified by their bytes and large ones are re-encoded to a 1600 px JPEG");
// the rendered image: right size, brand colours, real logo, photo drawn
const photo = pic("jpeg", 900, 1200), f = await renderFlyer({ username: "Ada_B", positionTitle: "Registrar", photo });
const img = await loadImage(f.png), cv = createCanvas(img.width, img.height), g = cv.getContext("2d"); g.drawImage(img, 0, 0);
const hex = (x, y) => "#" + [...g.getImageData(x, y, 1, 1).data].slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
assert.deepEqual([img.width, img.height], [1620, 2025]);
assert.equal(hex(8, 8), COLORS.bg, "dark brand green background"); assert.equal(hex(800, 2010), COLORS.deep, "call-to-action band"); assert.equal(hex(800, 1861), COLORS.gold, "gold rule");
assert.equal(hex(800, 700), "#000000", "photograph drawn exactly (the stand-in photo is a solid black rectangle)");
const near = (x, y, want) => { const d = g.getImageData(x, y, 1, 1).data, t = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16)); return t.every((v, i) => Math.abs(d[i] - v) <= 4); };
let paper = 0, sun = 0; for (let x = 84; x < 264; x++) for (let y = 60; y < 210; y++) { if (near(x, y, COLORS.paper)) paper++; if (near(x, y, COLORS.gold)) sun++; }
assert.ok(sun > 100, `the logo's gold sun is drawn (${sun}px)`); assert.ok(paper > 1500, `the real logo's off-white is drawn (${paper}px)`);
assert.deepEqual(f.lines, ["lifeinoau", "VOTE FOR", "@ADA_B", "AS REGISTRAR", "ON LIFEINOAU", "VISIT LIFEINOAU.COM NOW TO VOTE"]);
await assert.rejects(() => renderFlyer({ username: "X", positionTitle: "Registrar", photo: Buffer.alloc(0) }), /photograph is required/);
ok("the PNG is 1620x2025, uses the brand greens, gold and the real logo, draws the exact photo, and refuses to render without one");
console.log(`\n${n} groups passed`);
