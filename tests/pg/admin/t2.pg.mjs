import { makeDb } from "./db.mjs";
import { listPlayers, directorySummary, exportPlayers, playerDetail, findAccount } from "../../../lib/adminPlayers.js";
import { jsonSafe } from "../../../lib/adminCore.js";
const db = makeDb();
const sm = jsonSafe(await directorySummary(db)); console.log("summary", { ...sm, segments: undefined, coverage: sm.coverage.slice(0, 60) + "…" });
let r = jsonSafe(await listPlayers(db, {})); console.log("all", r.total, "pages", r.pages, "first", r.rows[0].name, r.rows[0].emailMasked, "regNo", r.rows[0].regNo);
r = jsonSafe(await listPlayers(db, { q: "player5@" })); console.log("search email", r.rows.map((x) => x.name));
r = jsonSafe(await listPlayers(db, { q: "Player12" })); console.log("search name", r.rows.map((x) => x.name + ":" + x.balance));
r = jsonSafe(await listPlayers(db, { q: "c0003" })); console.log("search char id", r.rows.map((x) => x.name));
r = jsonSafe(await listPlayers(db, { q: "0003" })); console.log("search public id (short)", r.total);
for (const status of ["ACTIVE", "SUSPENDED", "DELETED", "NO_CHARACTER", "JAILED"]) { r = jsonSafe(await listPlayers(db, { status })); console.log("status", status, r.total); }
for (const segment of ["early", "recent", "returning", "inactive", "active"]) { r = jsonSafe(await listPlayers(db, { segment })); console.log("segment", segment, r.total); }
r = jsonSafe(await listPlayers(db, { sort: "balance", dir: "desc", pageSize: "3" })); console.log("sort balance", r.rows.map((x) => x.balance));
r = jsonSafe(await listPlayers(db, { sort: "registeredAt", dir: "asc", pageSize: "2" })); console.log("earliest", r.rows.map((x) => `${x.regNo}:${x.userId}`));
r = jsonSafe(await listPlayers(db, { registeredFrom: "2026-09-01", class: "NEPO", level: "200" })); console.log("combined", r.total);
r = jsonSafe(await listPlayers(db, { presence: "online" })); console.log("presence online", r.total, r.rows.map((x) => x.name));
r = jsonSafe(await listPlayers(db, { page: "2", pageSize: "10" })); console.log("page2", r.page, r.rows.length);
const csv = await exportPlayers(db, "u0001", { status: "ACTIVE", segment: "recent" }); console.log("csv lines", csv.trim().split("\r\n").length, csv.split("\r\n")[0].slice(0, 90));
console.log("email in csv?", /example\.com/.test(csv));
const csv2 = await exportPlayers(db, "u0001", { emails: "1", pageSize: "2" }); console.log("email csv?", /example\.com/.test(csv2));
console.log("find by public id", await findAccount(db, "c0003".slice(-4).padStart(8, "x")).catch((e) => e.message));
const d = jsonSafe(await playerDetail(db, "u0001", "Player3")); console.log("detail keys", Object.keys(d).join(","));
console.log("detail", d.character.name, d.balance, d.forbes, d.presence.state, d.account.status, d.ledger.length, d.reports);
const d7 = jsonSafe(await playerDetail(db, "u0001", "u0007")); console.log("suspended detail", d7.account.status, d7.account.statusReason, d7.character.name);
const d40 = jsonSafe(await playerDetail(db, "u0001", "u0040")); console.log("no character detail", d40.character, d40.account.status);
const aud = await db.$queryRawUnsafe(`select action,status from "AuditLog" order by id desc limit 6`); console.log("audit tail", aud.map((a) => a.action + ":" + a.status).join(" "));
await db.end();
