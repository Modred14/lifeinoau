import data from "./data/departments.json";
import { SCHOOL_TYPE_LABEL, type SchoolType } from "./levels";

export const OTHER_DEPARTMENT_ID = "other";
export const OTHER_DEPARTMENT_NAME = "Another department";

export interface Department {
  id: string;
  name: string;
}

export interface DepartmentGroup {
  label: string;
  departments: Department[];
}

type ListedType = Exclude<SchoolType, "other">;
type RawGroup = [label: string, names: string[]];

const LISTED_TYPES: ListedType[] = ["university", "polytechnic", "college"];

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toGroups(raw: RawGroup[]): DepartmentGroup[] {
  return raw.map(([label, names]) => ({ label, departments: names.map((name) => ({ id: slug(name), name })) }));
}

function mergeAll(byType: Record<ListedType, DepartmentGroup[]>): DepartmentGroup[] {
  const seen = new Set<string>();
  return LISTED_TYPES.flatMap((type) =>
    byType[type].map((group) => ({
      label: `${SCHOOL_TYPE_LABEL[type]}: ${group.label}`,
      departments: group.departments.filter((d) => !seen.has(d.id) && seen.add(d.id)),
    })),
  ).filter((group) => group.departments.length > 0);
}

const RAW = data as unknown as Record<ListedType, RawGroup[]>;
const LISTED: Record<ListedType, DepartmentGroup[]> = {
  university: toGroups(RAW.university),
  polytechnic: toGroups(RAW.polytechnic),
  college: toGroups(RAW.college),
};

export const DEPARTMENT_GROUPS: Record<SchoolType, DepartmentGroup[]> = { ...LISTED, other: mergeAll(LISTED) };

const IDS: Record<SchoolType, Map<string, Department>> = {
  university: index(DEPARTMENT_GROUPS.university),
  polytechnic: index(DEPARTMENT_GROUPS.polytechnic),
  college: index(DEPARTMENT_GROUPS.college),
  other: index(DEPARTMENT_GROUPS.other),
};

function index(groups: DepartmentGroup[]): Map<string, Department> {
  return new Map(groups.flatMap((g) => g.departments.map((d) => [d.id, d] as const)));
}

export const OTHER_DEPARTMENT: Department = { id: OTHER_DEPARTMENT_ID, name: OTHER_DEPARTMENT_NAME };

export function findDepartment(type: SchoolType, id: unknown): Department | undefined {
  if (typeof id !== "string") return undefined;
  return id === OTHER_DEPARTMENT_ID ? OTHER_DEPARTMENT : IDS[type].get(id);
}

export function sanitizeDepartment(type: SchoolType, id: unknown): string {
  return findDepartment(type, id)?.id ?? "";
}

export function departmentCount(type: SchoolType): number {
  return IDS[type].size;
}
