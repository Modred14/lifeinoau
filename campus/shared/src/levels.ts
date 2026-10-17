export type SchoolType = "university" | "polytechnic" | "college" | "other";
export const SCHOOL_TYPES: SchoolType[] = ["university", "polytechnic", "college", "other"];

export const SCHOOL_TYPE_LABEL: Record<SchoolType, string> = {
  university: "University",
  polytechnic: "Polytechnic",
  college: "College of education",
  other: "Other",
};

const UNIVERSITY_LEVELS = ["100L", "200L", "300L", "400L", "500L", "600L", "Postgraduate"];
const POLYTECHNIC_LEVELS = ["ND1", "ND2", "HND1", "HND2"];
const COLLEGE_LEVELS = ["NCE1", "NCE2", "NCE3"];

export const LEVELS: Record<SchoolType, string[]> = {
  university: UNIVERSITY_LEVELS,
  polytechnic: POLYTECHNIC_LEVELS,
  college: COLLEGE_LEVELS,
  other: [...UNIVERSITY_LEVELS, ...POLYTECHNIC_LEVELS, ...COLLEGE_LEVELS],
};

export const OTHER_SCHOOL_ID = "other";
export const OTHER_SCHOOL_NAME = "Another school";

export const SCHOOL_QUERY_MIN_LENGTH = 2;
export const SCHOOL_QUERY_MAX_LENGTH = 60;
export const SCHOOL_SEARCH_LIMIT = 8;

export interface SchoolSummary {
  id: string;
  name: string;
  type: SchoolType;
  state: string;
}

export interface SchoolOption extends SchoolSummary {
  keywords: string[];
}

export function isSchoolType(v: unknown): v is SchoolType {
  return typeof v === "string" && (SCHOOL_TYPES as string[]).includes(v);
}

export function sanitizeLevel(type: SchoolType, v: unknown): string {
  return typeof v === "string" && LEVELS[type].includes(v) ? v : "";
}
