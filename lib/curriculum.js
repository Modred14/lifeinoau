// lib/curriculum.js
// Courses and lecturers are GAME CONTENT, not the official OAU curriculum, and every lecturer is fictional.
// Faculty names must match the Faculty table (prisma/seed.js).
const SCIENCE_LIKE = ["Science", "Technology", "Computer Science", "Pharmacy", "Agriculture"]; // faculties that get Mathematics with Boroks

export const LECTURERS = {
  BOROKS:       { name: "Boroks",           personality: "Loud, strict, and proud of how many people fail", style: "Races through the board and erases before you can copy", difficulty: 1.45, reputation: "Feared", surprise: 14 },
  IRON_CHALK:   { name: "Prof. Iron Chalk", personality: "Calm but unforgiving",                          style: "Dictates notes word for word",                           difficulty: 1.3,  reputation: "Respected", surprise: 5 },
  SOFT_LANDING: { name: "Dr. Soft Landing", personality: "Kind and a little forgetful",                    style: "Slides, long breaks, gentle marking",                    difficulty: 0.8,  reputation: "Loved", surprise: 2 },
  RED_PEN:      { name: "Madam Red Pen",    personality: "Fair, thorough, hates lateness",                 style: "Assignments every single week",                          difficulty: 1.2,  reputation: "Fair but firm", surprise: 6 },
  GIST:         { name: "Dr. Gist",         personality: "A storyteller who wanders off topic",            style: "Lectures wander, the exam does not",                     difficulty: 1.0,  reputation: "Popular", surprise: 4 },
  BLUEPRINT:    { name: "Engr. Blueprint",  personality: "Practical and impatient",                        style: "Diagrams on every wall",                                 difficulty: 1.15, reputation: "Respected", surprise: 7 },
  SLIDES:       { name: "Prof. Slides",     personality: "Reads every slide aloud",                        style: "Slides you can find online anyway",                      difficulty: 0.95, reputation: "Harmless", surprise: 3 },
  POP_QUIZ:     { name: "Dr. Surprise",     personality: "Lives for pop quizzes",                          style: "Tests on random days",                                   difficulty: 1.1,  reputation: "Unpredictable", surprise: 12 },
};
const OTHERS = Object.keys(LECTURERS).filter((k) => k !== "BOROKS");

// [title, code prefix] per faculty. Four subjects each.
const SUBJECTS = {
  "Science":            [["Mathematics", "MTH"], ["Physics", "PHY"], ["Chemistry", "CHM"], ["Biology", "BIO"]],
  "Technology":         [["Mathematics", "MTH"], ["Physics", "PHY"], ["Engineering Mechanics", "EMC"], ["Workshop Practice", "WSP"]],
  "Computer Science":   [["Mathematics", "MTH"], ["Programming", "CSC"], ["Discrete Structures", "CSC"], ["Computer Systems", "CSC"]],
  "Pharmacy":           [["Mathematics", "MTH"], ["Chemistry", "CHM"], ["Pharmaceutics", "PCH"], ["Physiology", "PHS"]],
  "Agriculture":        [["Mathematics", "MTH"], ["Crop Science", "AGR"], ["Soil Science", "SSC"], ["Animal Science", "ANS"]],
  "College of Health Sciences": [["Anatomy", "ANA"], ["Physiology", "PHS"], ["Biochemistry", "BCH"], ["Community Health", "CHL"]],
  "Law":                [["Legal Method", "LAW"], ["Constitutional Law", "LAW"], ["Contract Law", "LAW"], ["Criminal Law", "LAW"]],
  "Arts":               [["Literature", "ENG"], ["History", "HIS"], ["Philosophy", "PHL"], ["Language Studies", "LIN"]],
  "Education":          [["Foundations of Education", "EDU"], ["Psychology of Learning", "EDP"], ["Curriculum Studies", "EDC"], ["Teaching Methods", "EDM"]],
  "Administration":     [["Accounting", "ACC"], ["Management", "MGT"], ["Public Administration", "PAD"], ["Business Law", "BUS"]],
  "Social Sciences":    [["Economics", "ECO"], ["Psychology", "PSY"], ["Political Science", "POL"], ["Sociology", "SOC"]],
  "Environmental Design & Management": [["Design Studio", "ARC"], ["Building Technology", "BLD"], ["Surveying", "SUR"], ["Planning", "URP"]],
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"], TIMES = ["8AM", "10AM", "12PM", "2PM", "4PM"];
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const hasBoroks = (faculty) => SCIENCE_LIKE.includes(faculty);
export const FACULTIES_WITH_COURSES = Object.keys(SUBJECTS);

/** The 4 courses a student takes at a level. facultyDifficulty comes from the Faculty table (about 0.8 to 1.3). */
export function coursesFor(faculty, level, facultyDifficulty = 1) {
  const subjects = SUBJECTS[faculty]; if (!subjects) return [];
  const L = Math.max(1, Math.floor(level / 100));
  return subjects.map(([subject, prefix], i) => {
    const maths = subject === "Mathematics" && hasBoroks(faculty);
    const key = maths ? "BOROKS" : OTHERS[hash(`${faculty}:${subject}:${L}`) % OTHERS.length], lec = LECTURERS[key], h = hash(`${faculty}:${prefix}:${i}`);
    return { code: `${prefix} ${L}${String(i + 1).padStart(2, "0")}`, title: `${subject} ${"I".repeat(Math.min(L, 3)) || "I"}${L > 3 ? " (" + L + ")" : ""}`.trim(), subject, lecturerKey: key, lecturer: lec,
      difficulty: Math.round(lec.difficulty * (1 + (facultyDifficulty - 1) * 0.5) * 100) / 100, slot: `${DAYS[h % 5]} ${TIMES[(h >> 3) % 5]}` };
  });
}