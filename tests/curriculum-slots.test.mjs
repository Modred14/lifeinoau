import assert from "node:assert/strict";
import { FACULTIES_WITH_COURSES, coursesFor } from "../lib/curriculum.js";
for (const faculty of FACULTIES_WITH_COURSES) {
  for (const level of [100, 200, 300, 400, 500, 600]) {
    const courses = coursesFor(faculty, level);
    assert.equal(courses.length, 4);
    for (const course of courses) assert.match(course.slot, /^(Mon|Tue|Wed|Thu|Fri) (8AM|10AM|12PM|2PM|4PM)$/);
  }
}
console.log("Every OAU course has a valid weekday and lecture time.");
