// lib/facultyGroupRules.js
// Small pure helpers for faculty groups. No database, no imports.

/** "Faculty of Environmental Design and Management" -> "Environmental Design and Management Faculty Group". */
export const groupName = (facultyName) => `${String(facultyName ?? "").replace(/^Faculty of /i, "").trim()} Faculty Group`;

/** Escape % _ \ so a typed search is matched literally by ILIKE (Prisma's `contains` does not do it). */
export const likeEscape = (s) => String(s ?? "").replace(/[\\%_]/g, (m) => "\\" + m);
