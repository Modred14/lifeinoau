// lib/adminSql.js
// A tiny, safe builder for the dashboard's SQL. Every value travels as a numbered parameter ($1, $2 ...), never inside the SQL text, so
// nothing an administrator types can change what a query means. Column names that vary (sorting) only ever come from a fixed list.
/** "Now" the way Prisma stores it: UTC wall-clock time in a timestamp-without-time-zone column. Plain now() would be shifted by the database session's time zone. */
export const NOW = "(now() AT TIME ZONE 'UTC')";

export function where() {
  const values = [], parts = [];
  const param = (v) => { values.push(v); return "$" + values.length; };
  return {
    values, param,
    /** add("c.level >= ?", 200): each ? becomes the next parameter */
    add(cond, ...vals) { let c = cond; for (const v of vals) c = c.replace("?", param(v)); parts.push(c); return this; },
    clause: () => (parts.length ? "WHERE " + parts.join(" AND ") : ""),
    has: () => parts.length > 0,
  };
}
/** ORDER BY from a whitelist: key -> SQL expression. Anything else falls back to the first entry. */
export function orderBy(map, key, dir, tie = "") {
  const keys = Object.keys(map), k = keys.includes(key) ? key : keys[0];
  return `ORDER BY ${map[k]} ${String(dir).toLowerCase() === "asc" ? "ASC" : "DESC"} NULLS LAST${tie ? ", " + tie : ""}`;
}
/** Text for ILIKE: the user's words with the wildcard characters made literal. */
export const like = (s) => "%" + String(s).replace(/[\\%_]/g, (m) => "\\" + m) + "%";
