// lib/faculties.js
// The faculties a player can pick at sign-up. Names are game content and are flagged unverified against the official OAU list.
// Difficulty is a game number (about 0.8 to 1.3), not a real statistic.
export const FACULTIES = [
  ["Faculty of Administration", 0.9],
  ["Faculty of Agriculture", 0.9],
  ["Faculty of Arts", 0.8],
  ["Faculty of Basic Medical Sciences", 1.3],
  ["Faculty of Basic Clinical Sciences", 1.3],
  ["Faculty of Clinical Sciences", 1.3],
  ["Faculty of Computing Science & Engineering", 1.2],
  ["Faculty of Dentistry", 1.3],
  ["Faculty of Education", 0.8],
  ["Faculty of Environmental Design and Management", 1.1],
  ["Faculty of Law", 1.2],
  ["Faculty of Pharmacy", 1.3],
  ["Faculty of Science", 1.1],
  ["Faculty of Social Sciences", 0.9],
  ["Faculty of Technology", 1.3],
];

/** Maps a faculty name (new or older seed names) to the key used by the course and job rules. */
export function facultyKey(name) {
  const n = String(name ?? "").replace(/^Faculty of /i, "").replace(/\band\b/gi, "&").replace(/\s+/g, " ").trim();
  if (n === "Computing Science & Engineering") return "Computer Science";
  return n;
}