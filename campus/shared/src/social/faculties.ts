import { PLACES } from "../map";
import { DEPARTMENT_GROUPS } from "../departments";
import { FACULTIES, FACULTY_HOMES, facultyOf } from "../politics/faculty";

export interface FacultyTeam {
  index: number;
  key: string;
  label: string;
  name: string;
  code: string;
  color: number;
  place: number;
}

const TEAM_COLORS: readonly number[] = [0x1d4ed8, 0x2f8f3a, 0xb45309, 0x0e7490, 0xc62828, 0x15803d, 0x7c2d12, 0x4338ca, 0xd97706, 0x374151, 0x0f766e, 0x111827, 0x6d28d9, 0xbe123c, 0xa16207];
const SHORT_NAMES: Record<string, [name: string, code: string]> = {
  "Administration and Management": ["Admin", "ADM"],
  Agriculture: ["Agric", "AGR"],
  "Arts and Humanities": ["Arts", "ART"],
  "Basic Medical Sciences": ["BMS", "BMS"],
  "Medicine and Health Sciences": ["Health Sciences", "MED"],
  Pharmacy: ["Pharmacy", "PHA"],
  "Veterinary Medicine": ["Vet", "VET"],
  "Computing and Information Technology": ["Computing", "CIT"],
  Education: ["Education", "EDU"],
  "Engineering and Technology": ["Tech", "TEC"],
  "Environmental Sciences": ["EDM", "EDM"],
  Law: ["Law", "LAW"],
  Sciences: ["Science", "SCI"],
  "Social Sciences": ["Social Sciences", "SOC"],
  "Communication and Media": ["Media", "MDA"],
};
const HOME = /student union/i;

const home = PLACES.findIndex((p) => HOME.test(p.name));
const UNIVERSITY_LABELS = new Set(DEPARTMENT_GROUPS.university.map((g) => g.label));

function placeFor(key: string): number {
  const hall = FACULTY_HOMES.find((h) => h.faculties.test(key));
  const found = hall ? PLACES.findIndex((p) => hall.place.test(p.name)) : -1;
  return found >= 0 ? found : home;
}

export const FACULTY_TEAMS: readonly FacultyTeam[] = FACULTIES.filter((f) => UNIVERSITY_LABELS.has(f.label)).map((f, index) => {
  const short = SHORT_NAMES[f.label] ?? [f.label, f.label.slice(0, 3).toUpperCase()];
  return { index, key: f.key, label: f.label, name: short[0], code: short[1], color: TEAM_COLORS[index % TEAM_COLORS.length], place: placeFor(f.key) };
});

export function facultyIndexOf(department: string | undefined): number {
  const ref = department ? facultyOf(department) : undefined;
  return ref ? FACULTY_TEAMS.findIndex((t) => t.key === ref.key) : -1;
}

export const facultyTeam = (index: number): FacultyTeam | undefined => FACULTY_TEAMS[index];

export function facultyOfWeek(week: number): number {
  const n = FACULTY_TEAMS.length;
  return n ? ((week % n) + n) % n : -1;
}

export const weekOf = (dayIndex: number): number => Math.floor(dayIndex / 7);
