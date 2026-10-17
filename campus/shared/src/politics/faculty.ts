import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT_ID } from "../departments";
import type { SchoolType } from "../levels";

export interface FacultyRef {
  key: string;
  label: string;
}

const TYPES: SchoolType[] = ["university", "polytechnic", "college"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const BY_DEPARTMENT = new Map<string, { faculty: FacultyRef; name: string }>();
for (const type of TYPES)
  for (const group of DEPARTMENT_GROUPS[type])
    for (const d of group.departments) if (!BY_DEPARTMENT.has(d.id)) BY_DEPARTMENT.set(d.id, { faculty: { key: slug(group.label), label: group.label }, name: d.name });

export const FACULTIES: readonly FacultyRef[] = [...new Map([...BY_DEPARTMENT.values()].map((v) => [v.faculty.key, v.faculty])).values()];

export function facultyOf(department: string): FacultyRef | undefined {
  return department && department !== OTHER_DEPARTMENT_ID ? BY_DEPARTMENT.get(department)?.faculty : undefined;
}

export const departmentLabel = (department: string): string => BY_DEPARTMENT.get(department)?.name ?? "";
export const facultyLabel = (key: string): string => FACULTIES.find((f) => f.key === key)?.label ?? "";
export const departmentsIn = (key: string): string[] => [...BY_DEPARTMENT.entries()].filter(([, v]) => v.faculty.key === key).map(([, v]) => v.name);

export interface FacultyHome {
  unit: string;
  name: string;
  place: RegExp;
  faculties: RegExp;
}

export const FACULTY_HOMES: readonly FacultyHome[] = [
  { unit: "law", name: "Faculty of Law", place: /^Faculty of Law$/, faculties: /^law$|legal/ },
  { unit: "arts", name: "Faculty of Arts", place: /^Faculty of Arts \(Block 1\)$/, faculties: /^arts-and-humanities$|languages|communication|art-design/ },
  { unit: "tech", name: "Faculty of Technology", place: /^Faculty of Technology$/, faculties: /engineering|computing|information-and-communication|technical/ },
  { unit: "socsci", name: "Faculty of Social Sciences", place: /^Faculty of Social Sciences$/, faculties: /social-sciences/ },
  { unit: "edu", name: "Faculty of Education", place: /^Faculty of Education$/, faculties: /education/ },
  { unit: "admin", name: "Faculty of Administration", place: /^Faculty of Administration$/, faculties: /administration|business|hospitality/ },
  { unit: "pharm", name: "Faculty of Pharmacy", place: /^Faculty of Pharmacy$/, faculties: /pharmacy|medic|health|veterinary/ },
  { unit: "env", name: "Faculty of EDM", place: /^New Faculty of Environmental/, faculties: /environmental/ },
  { unit: "sci", name: "White House (Science)", place: /^White House$/, faculties: /sciences$/ },
];

export const SUB_UNIT = "sub";
export function unitOfFaculty(key: string): string {
  return FACULTY_HOMES.find((h) => h.faculties.test(key))?.unit ?? SUB_UNIT;
}
