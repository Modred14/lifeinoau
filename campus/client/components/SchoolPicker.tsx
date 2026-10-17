"use client";

import { OTHER_SCHOOL_ID, OTHER_SCHOOL_NAME, SCHOOL_TYPE_LABEL, isSchoolType, type SchoolOption, type SchoolSummary, type SchoolType } from "@campuslife/shared/levels";
import { useRemoteList } from "@campus/lib/use-remote-list";
import { SearchSelect } from "./SearchSelect";

const SCHOOLS_ENDPOINT = "/api/schools";

const COPY = {
  label: "Your school",
  placeholder: "Select your school",
  search: "Search schools",
  loading: "Loading schools…",
  failed: "Couldn't load schools. Check your connection.",
  retry: "Try again",
  empty: "No school found.",
  notListed: "My school is not listed",
};

const GROUPS: { type: SchoolType; label: string }[] = [
  { type: "university", label: "Universities" },
  { type: "polytechnic", label: "Polytechnics" },
  { type: "college", label: "Colleges of education" },
];

const OTHER_SCHOOL: SchoolSummary = { id: OTHER_SCHOOL_ID, name: OTHER_SCHOOL_NAME, type: "other", state: "" };

function isSchool(v: unknown): v is SchoolSummary {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return typeof s.id === "string" && typeof s.name === "string" && typeof s.state === "string" && isSchoolType(s.type);
}

function toOption(v: unknown): SchoolOption | null {
  if (!isSchool(v)) return null;
  const keywords = (v as { keywords?: unknown }).keywords;
  return { id: v.id, name: v.name, type: v.type, state: v.state, keywords: Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === "string") : [] };
}

export function parseSchool(raw: string | null): SchoolSummary | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSchool(parsed) ? { id: parsed.id, name: parsed.name, type: parsed.type, state: parsed.state } : null;
  } catch {
    return null;
  }
}

function parseSchools(body: unknown): SchoolOption[] {
  const list = typeof body === "object" && body !== null ? (body as { schools?: unknown }).schools : undefined;
  return Array.isArray(list) ? list.map(toOption).filter((s): s is SchoolOption => s !== null) : [];
}

export function SchoolPicker({ school, onSchool }: { school: SchoolSummary | null; onSchool: (school: SchoolSummary) => void }) {
  const { state, retry } = useRemoteList(SCHOOLS_ENDPOINT, parseSchools);
  const schools = state.status === "done" ? state.data : [];

  function select(id: string) {
    const next = id === OTHER_SCHOOL_ID ? OTHER_SCHOOL : schools.find((s) => s.id === id);
    if (next) onSchool({ id: next.id, name: next.name, type: next.type, state: next.state });
  }

  return (
    <SearchSelect
      id="school"
      label={COPY.label}
      placeholder={state.status === "loading" ? COPY.loading : COPY.placeholder}
      searchPlaceholder={COPY.search}
      emptyText={COPY.empty}
      groups={GROUPS.map((group) => ({ label: group.label, items: schools.filter((s) => s.type === group.type) }))}
      other={{ id: OTHER_SCHOOL_ID, label: COPY.notListed, heading: SCHOOL_TYPE_LABEL.other }}
      selected={school}
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
