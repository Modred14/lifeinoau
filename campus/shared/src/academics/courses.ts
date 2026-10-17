import { coursesFor as oauCoursesFor } from "../../../../lib/curriculum.js";
import { findDepartment } from "../departments";
import { pickFrom, randomFor, shuffled } from "./seed";

export type Temperament = "strict" | "chill" | "late" | "surprise";

export interface Lecturer {
  name: string;
  temperament: Temperament;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  units: number;
  gst: boolean;
  lecturer: Lecturer;
}

export const TEMPERAMENT_LABEL: Record<Temperament, string> = {
  strict: "Strict, marks attendance well",
  chill: "Chill",
  late: "Always late",
  surprise: "Loves surprise tests",
};

const TEMPERAMENTS: Temperament[] = ["strict", "chill", "late", "surprise"];
const LECTURER_TITLES = ["Dr", "Prof", "Mr", "Mrs", "Dr", "Mr"];
const LECTURER_INITIALS = "ABCDEFGIJKMNOSTUY";
const LECTURER_SURNAMES = [
  "Adegbite", "Olawuyi", "Nwachukwu", "Ogunleye", "Akinwale", "Ibekwe", "Oyelaran", "Umeh", "Garba", "Olatunji",
  "Ekanem", "Adeyinka", "Nnamani", "Salami", "Oladipo", "Chukwuma", "Ogbonna", "Akande", "Etim", "Onyeka",
  "Adewumi", "Odukoya", "Bamgbose", "Ugwuanyi", "Shittu", "Ayansola", "Okoronkwo", "Dalhatu", "Ikpeme", "Fagbemi",
];

const GST_PREFIX = "GST";
const GST_UNITS = 2;
const GST_PER_YEAR_JUNIOR = 3;
const GST_PER_YEAR_SENIOR = 2;
const JUNIOR_YEARS = 2;
const GST_TITLES = [
  "Use of English",
  "Nigerian Peoples and Culture",
  "History and Philosophy of Science",
  "Entrepreneurship Studies",
  "Logic and Critical Thinking",
  "Peace and Conflict Studies",
  "Communication in English II",
  "Leadership and Governance",
  "Venture Creation",
  "Environment and Sustainable Development",
  "Science, Technology and Society",
  "Introduction to Nigerian Law",
  "Research and Report Writing",
  "Health and Human Development",
  "Project Planning and Management",
  "Ethics and Professional Practice",
];

const DEPARTMENT_COURSES = 4;
const MIN_UNITS = 2;
const MAX_UNITS = 3;
const FALLBACK_SUBJECT = "Liberal Studies";
const FALLBACK_DEPARTMENT = "general";
const INTRO_FRAME = "Introduction to {s}";
const TITLE_FRAMES = [
  "Principles of {s}",
  "History of {s}",
  "Methods in {s}",
  "Applied {s}",
  "Theory of {s}",
  "Statistics for {s}",
  "Contemporary Issues in {s}",
  "Ethics in {s}",
  "{s} Practice",
  "{s} Seminar",
  "Research Methods in {s}",
  "Field Work in {s}",
  "{s} and Society",
  "Computer Applications in {s}",
  "Advanced Topics in {s}",
];
const STOP_WORDS = new Set(["and", "of", "the", "in", "for"]);
const PREFIX_OVERRIDES: Record<string, string> = {
  "computer-science": "CSC",
  mathematics: "MTH",
  chemistry: "CHM",
  "political-science": "POL",
  "mass-communication": "MAC",
};
const PREFIX_LENGTH = 3;
const PREFIX_PAD = "X";

const LEVEL_PATTERNS: [RegExp, number][] = [
  [/^(\d)00L$/, 0],
  [/^HND(\d)$/, 2],
  [/^ND(\d)$/, 0],
  [/^NCE(\d)$/, 0],
];
const POSTGRADUATE_YEAR = 7;
const DEFAULT_YEAR = 1;

export function levelYear(level: string): number {
  for (const [pattern, offset] of LEVEL_PATTERNS) {
    const match = pattern.exec(level);
    if (match) return Number(match[1]) + offset;
  }
  return /^postgraduate$/i.test(level) ? POSTGRADUATE_YEAR : DEFAULT_YEAR;
}

export function departmentSubject(department: string): string {
  const found = findDepartment("other", department);
  return found && found.id !== "other" ? found.name : FALLBACK_SUBJECT;
}

export function coursePrefix(department: string): string {
  const override = PREFIX_OVERRIDES[department];
  if (override) return override;
  const words = departmentSubject(department)
    .split(/[^A-Za-z]+/)
    .filter((word) => word && !STOP_WORDS.has(word.toLowerCase()));
  const raw = words.length >= PREFIX_LENGTH ? words.slice(0, PREFIX_LENGTH).map((word) => word[0]).join("") : words.length === 2 ? words[0].slice(0, 2) + words[1][0] : (words[0] ?? "");
  const prefix = raw.slice(0, PREFIX_LENGTH).toUpperCase().padEnd(PREFIX_LENGTH, PREFIX_PAD);
  return prefix === GST_PREFIX ? prefix.slice(0, PREFIX_LENGTH - 1) + PREFIX_PAD : prefix;
}

function lecturerFor(courseId: string): Lecturer {
  const rand = randomFor(`lecturer:${courseId}`);
  const title = pickFrom(LECTURER_TITLES, rand);
  const initial = LECTURER_INITIALS[Math.floor(rand() * LECTURER_INITIALS.length)];
  const surname = pickFrom(LECTURER_SURNAMES, rand);
  return { name: `${title} ${initial}. ${surname}`, temperament: pickFrom(TEMPERAMENTS, rand) };
}

const courseNumber = (year: number, index: number) => `${year}${String(1 + index * 2).padStart(2, "0")}`;

function gstTitleIndex(year: number, k: number): number {
  if (year <= JUNIOR_YEARS) return (year - 1) * GST_PER_YEAR_JUNIOR + k;
  return JUNIOR_YEARS * GST_PER_YEAR_JUNIOR + (year - JUNIOR_YEARS - 1) * GST_PER_YEAR_SENIOR + k;
}

export function gstCourses(year: number): Course[] {
  const count = year <= JUNIOR_YEARS ? GST_PER_YEAR_JUNIOR : GST_PER_YEAR_SENIOR;
  return Array.from({ length: count }, (_, k) => {
    const id = `gst:${year}:${k}`;
    return {
      id,
      code: `${GST_PREFIX} ${courseNumber(year, k)}`,
      title: GST_TITLES[gstTitleIndex(year, k) % GST_TITLES.length],
      units: GST_UNITS,
      gst: true,
      lecturer: lecturerFor(id),
    };
  });
}

export function departmentCourses(department: string, year: number): Course[] {
  const key = department || FALLBACK_DEPARTMENT;
  const subject = departmentSubject(department);
  const prefix = coursePrefix(department);
  const rand = randomFor(`titles:${key}:${year}`);
  const frames = shuffled(TITLE_FRAMES, rand);
  if (year === DEFAULT_YEAR) frames.unshift(INTRO_FRAME);
  return Array.from({ length: DEPARTMENT_COURSES }, (_, j) => {
    const id = `${key}:${year}:${j}`;
    return {
      id,
      code: `${prefix} ${courseNumber(year, j)}`,
      title: frames[j].replace("{s}", subject),
      units: MIN_UNITS + Math.floor(rand() * (MAX_UNITS - MIN_UNITS + 1)),
      gst: false,
      lecturer: lecturerFor(id),
    };
  });
}

export function coursesFor(department: string, level: string): Course[] {
  const year = levelYear(level);
  if (department.startsWith("oau:")) return oauCoursesFor(department.slice(4), year * 100).map((course) => ({ id: `oau:${course.code}`, code: course.code, title: course.title, units: 3, gst: false, lecturer: { name: course.lecturer.name, temperament: course.difficulty >= 1.2 ? "strict" as const : "chill" as const } }));
  return [...gstCourses(year), ...departmentCourses(department, year)];
}
