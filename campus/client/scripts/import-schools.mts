/**
 * Imports the list of Nigerian universities, polytechnics and colleges of education.
 *
 *   npm run schools -w web            (uses the cached download if present)
 *   npm run schools -w web -- --fresh (re-download)
 *
 * Source: github.com/reality-farouqk/nigeria-tertiary-institutions-api (data/ is CC0 1.0),
 * compiled from the NUC, NBTE and NCCE directories.
 *
 * Output: shared/src/data/schools.json, one row per school:
 *   [id, name, type index (SCHOOL_TYPES), ownership index (OWNERSHIPS), state, website host]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(webRoot, ".cache/schools");
const outFile = path.resolve(webRoot, "../shared/src/data/schools.json");
const SOURCE_BASE = "https://raw.githubusercontent.com/reality-farouqk/nigeria-tertiary-institutions-api/main/data";
const USER_AGENT = "Campus-Life/0.1 (fan-made game; school list import)";
const ID_MAX_LENGTH = 80;

const SOURCES = [
  { file: "nigerian_universities_faculties.csv", type: 0, nameColumn: "University Name", stateColumn: "Location" },
  { file: "nigerian_polytechnics_schools.csv", type: 1, nameColumn: "Institution Name", stateColumn: "State" },
  { file: "nigerian_colleges_of_education_schools.csv", type: 2, nameColumn: "Institution Name", stateColumn: "State" },
];
const OWNERSHIPS = ["Federal", "State", "Private"];

type Row = [string, string, number, number, string, string];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

async function load(file: string, fresh: boolean): Promise<string> {
  const cached = path.join(cacheDir, file);
  if (!fresh) {
    try {
      return await readFile(cached, "utf8");
    } catch {
      /* not cached yet */
    }
  }
  const res = await fetch(`${SOURCE_BASE}/${file}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, text);
  return text;
}

function slug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ID_MAX_LENGTH)
    .replace(/-+$/, "");
}

function host(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const fresh = process.argv.includes("--fresh");
const rows: Row[] = [];
const seen = new Set<string>();

for (const source of SOURCES) {
  const [header, ...records] = parseCsv(await load(source.file, fresh));
  const col = (name: string) => header.findIndex((h) => h.trim() === name);
  const nameAt = col(source.nameColumn);
  const stateAt = col(source.stateColumn);
  const ownerAt = col("Category");
  const siteAt = col("Website");
  if (nameAt < 0 || stateAt < 0 || ownerAt < 0) throw new Error(`${source.file}: unexpected columns ${header.join(", ")}`);
  for (const record of records) {
    const name = record[nameAt].replace(/\s+/g, " ").trim();
    const ownership = OWNERSHIPS.indexOf(record[ownerAt].trim());
    if (!name || ownership < 0) throw new Error(`${source.file}: bad row ${record.slice(0, 4).join(" | ")}`);
    const id = slug(name);
    if (!id || seen.has(id)) throw new Error(`${source.file}: duplicate or empty id for "${name}"`);
    seen.add(id);
    rows.push([id, name, source.type, ownership, record[stateAt].trim(), siteAt >= 0 ? host(record[siteAt].trim()) : ""]);
  }
}

rows.sort((a, b) => a[1].localeCompare(b[1]));
await writeFile(outFile, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`Wrote ${rows.length} schools to ${path.relative(process.cwd(), outFile)}`);
