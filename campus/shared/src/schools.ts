import rows from "./data/schools.json";
import {
  OTHER_SCHOOL_ID,
  OTHER_SCHOOL_NAME,
  SCHOOL_QUERY_MAX_LENGTH,
  SCHOOL_QUERY_MIN_LENGTH,
  SCHOOL_SEARCH_LIMIT,
  SCHOOL_TYPES,
  type SchoolOption,
  type SchoolSummary,
} from "./levels";

export const SCHOOL_DATA_CREDIT = "School list from the NUC, NBTE and NCCE directories (CC0 dataset by reality-farouqk).";

type Row = [id: string, name: string, type: number, ownership: number, state: string, host: string];

interface Entry {
  school: SchoolSummary;
  words: string[];
  haystack: string;
  shortNames: string[];
}

const STOP_WORDS = new Set(["of", "the", "and", "for", "in"]);

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function initials(text: string): string {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => w[0])
    .join("");
}

function toEntry([id, name, type, , state, host]: Row): Entry {
  const hostLabel = host.split(".")[0] ?? "";
  const shortNames = [initials(name.split(",")[0]), initials(name), hostLabel].filter((s) => s.length > 1);
  const words = normalize(name).split(" ");
  return {
    school: { id, name, type: SCHOOL_TYPES[type] ?? "other", state },
    words,
    haystack: [...words, ...shortNames, normalize(state)].join(" "),
    shortNames,
  };
}

const ENTRIES: Entry[] = (rows as Row[]).map(toEntry);
const BY_ID = new Map<string, SchoolSummary>(ENTRIES.map((e) => [e.school.id, e.school]));

export const OTHER_SCHOOL: SchoolSummary = { id: OTHER_SCHOOL_ID, name: OTHER_SCHOOL_NAME, type: "other", state: "" };
export const SCHOOL_COUNT = ENTRIES.length;

export function listSchools(): SchoolOption[] {
  return ENTRIES.map((e) => ({ ...e.school, keywords: [...e.shortNames, e.school.state] }));
}

export function findSchool(id: unknown): SchoolSummary | undefined {
  if (typeof id !== "string") return undefined;
  return id === OTHER_SCHOOL_ID ? OTHER_SCHOOL : BY_ID.get(id);
}

function rank(entry: Entry, query: string, tokens: string[]): number {
  const joined = tokens.join("");
  if (entry.shortNames.includes(joined)) return 0;
  if (entry.words.join(" ").startsWith(query)) return 1;
  if (entry.shortNames.some((s) => s.startsWith(joined))) return 2;
  if (tokens.every((t) => entry.words.some((w) => w.startsWith(t)))) return 3;
  return 4;
}

export function searchSchools(rawQuery: unknown, limit = SCHOOL_SEARCH_LIMIT): SchoolSummary[] {
  if (typeof rawQuery !== "string") return [];
  const query = normalize(rawQuery.slice(0, SCHOOL_QUERY_MAX_LENGTH));
  if (query.length < SCHOOL_QUERY_MIN_LENGTH) return [];
  const tokens = query.split(" ");
  return ENTRIES.filter((e) => tokens.every((t) => e.haystack.includes(t)))
    .map((e) => ({ e, score: rank(e, query, tokens) }))
    .sort((a, b) => a.score - b.score || a.e.school.name.localeCompare(b.e.school.name))
    .slice(0, limit)
    .map(({ e }) => e.school);
}
