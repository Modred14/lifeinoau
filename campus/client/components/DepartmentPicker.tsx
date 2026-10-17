"use client";

import type { Department, DepartmentGroup } from "@campuslife/shared/departments";
import { SCHOOL_TYPES, SCHOOL_TYPE_LABEL, type SchoolType } from "@campuslife/shared/levels";
import { useRemoteList } from "@campus/lib/use-remote-list";
import { SearchSelect } from "./SearchSelect";

const DEPARTMENTS_ENDPOINT = "/api/departments";
const OTHER_DEPARTMENT_ID = "other";

const COPY = {
  label: "Your department",
  placeholder: "Select your department",
  search: "Search departments",
  loading: "Loading departments…",
  failed: "Couldn't load departments. Check your connection.",
  retry: "Try again",
  empty: "No department found.",
  notListed: "My department is not listed",
  otherName: "Another department",
};

type DepartmentsByType = Record<SchoolType, DepartmentGroup[]>;

function isDepartment(v: unknown): v is Department {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d.id === "string" && typeof d.name === "string";
}

function toGroup(v: unknown): DepartmentGroup | null {
  if (typeof v !== "object" || v === null) return null;
  const g = v as Record<string, unknown>;
  if (typeof g.label !== "string" || !Array.isArray(g.departments)) return null;
  return { label: g.label, departments: g.departments.filter(isDepartment).map((d) => ({ id: d.id, name: d.name })) };
}

export function parseDepartment(raw: string | null): Department | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDepartment(parsed) ? { id: parsed.id, name: parsed.name } : null;
  } catch {
    return null;
  }
}

function parseDepartments(body: unknown): DepartmentsByType {
  const raw = typeof body === "object" && body !== null ? (body as { departments?: unknown }).departments : undefined;
  const byType = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const result: DepartmentsByType = { university: [], polytechnic: [], college: [], other: [] };
  for (const type of SCHOOL_TYPES) {
    const groups = byType[type];
    if (Array.isArray(groups)) result[type] = groups.map(toGroup).filter((g): g is DepartmentGroup => g !== null);
  }
  return result;
}

interface Props {
  schoolType: SchoolType;
  department: Department | null;
  onDepartment: (department: Department) => void;
}

export function DepartmentPicker({ schoolType, department, onDepartment }: Props) {
  const { state, retry } = useRemoteList(DEPARTMENTS_ENDPOINT, parseDepartments);
  const groups = state.status === "done" ? state.data[schoolType] : [];

  function select(id: string) {
    if (id === OTHER_DEPARTMENT_ID) return onDepartment({ id, name: COPY.otherName });
    const next = groups.flatMap((g) => g.departments).find((d) => d.id === id);
    if (next) onDepartment(next);
  }

  return (
    <SearchSelect
      id="department"
      label={COPY.label}
      placeholder={state.status === "loading" ? COPY.loading : COPY.placeholder}
      searchPlaceholder={COPY.search}
      emptyText={COPY.empty}
      groups={groups.map((g) => ({ label: g.label, items: g.departments }))}
      other={{ id: OTHER_DEPARTMENT_ID, label: COPY.notListed, heading: SCHOOL_TYPE_LABEL.other }}
      selected={department}
      disabled={state.status !== "done"}
      onSelect={select}
      status={
        state.status === "error" && (
          <>
            {COPY.failed}{" "}
            <button type="button" className="link-btn" onClick={retry}>
              {COPY.retry}
            </button>
          </>
        )
      }
    />
  );
}
