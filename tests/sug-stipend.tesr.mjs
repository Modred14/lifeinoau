// tests/sug-stipend.test.mjs: what SUG office pays. Executives, Speaker, Deputy Speaker and Clerk: N100,000 a day; Honourable Members: N70,000 a week.
// Pure Node: the rules (lib/sugRules.js) and the payer (lib/sugPay.js) against a small in-memory stand-in for the database.
import * as R from "../lib/sugRules.js";
import { payStipends } from "../lib/sugPay.js";
let bad = 0; const chk = (l, c, x) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && x !== undefined ? "  -> " + x : "")); };
const DAY = 24 * R.HOUR, T0 = Date.UTC(2026, 9, 28, 7), term = { startsAt: new Date(T0), endsAt: new Date(T0 + 7 * DAY) };
const kobo = (n) => BigInt(n) * 100n;

// ---- who earns what ----
const exec = R.POSITIONS.filter((p) => p.group === "EXECUTIVE").map((p) => p.key);
chk("there are 9 executive posts and each earns N100,000 a day", exec.length === 9 && exec.every((k) => R.stipendOf(k).amountKobo === kobo(100_000) && R.stipendOf(k).periodHours === 24));
chk("the Speaker, the Deputy Speaker and the Clerk earn the same as an executive", ["SPEAKER", "DEPUTY_SPEAKER", "CLERK"].every((k) => R.stipendOf(k) === R.stipendOf(exec[0])));
chk("an Honourable Member earns N70,000 a week", R.stipendOf("HONOURABLE_MEMBER").amountKobo === kobo(70_000) && R.stipendOf("HONOURABLE_MEMBER").periodHours === 168);
chk("anything else earns nothing", R.stipendOf("NOPE") === null && R.stipendLabel("NOPE") === null);
chk("the labels the screens show", R.stipendLabel("PRESIDENT") === "₦100,000 a day" && R.stipendLabel("HONOURABLE_MEMBER") === "₦70,000 a week", [R.stipendLabel("PRESIDENT"), R.stipendLabel("HONOURABLE_MEMBER")]);

// ---- when it falls due ----
const elected = (position, extra = {}) => ({ position, startedAt: new Date(T0 - 8 * R.HOUR), endedAt: null, ...extra }); // elected before the term begins
const due = (a, ms) => R.stipendsDue(a, term, ms);
chk("nothing is due before the first day is over", due(elected("PRESIDENT"), T0 + DAY - 1).length === 0);
chk("day 1 is paid the moment it ends", due(elected("PRESIDENT"), T0 + DAY).length === 1);
chk("three full days: three payments of N100,000", (() => { const d = due(elected("PRESIDENT"), T0 + 3 * DAY + 5); return d.length === 3 && d.every((x) => x.amountKobo === kobo(100_000)); })());
chk("a full term pays an executive 7 days: N700,000", due(elected("PRESIDENT"), T0 + 30 * DAY).length === 7 && due(elected("PRESIDENT"), T0 + 30 * DAY).reduce((n, x) => n + x.amountKobo, 0n) === kobo(700_000));
chk("nothing is paid after the term ends", due(elected("PRESIDENT"), T0 + 100 * DAY).length === 7);
chk("an Honourable Member is paid once, when the week is over: N70,000", due(elected("HONOURABLE_MEMBER"), T0 + 7 * DAY - 1).length === 0 && due(elected("HONOURABLE_MEMBER"), T0 + 7 * DAY).length === 1 && due(elected("HONOURABLE_MEMBER"), T0 + 99 * DAY)[0].amountKobo === kobo(70_000));
chk("a Clerk named on day 3 (after it began) is paid from day 4 on", (() => { const c = { position: "CLERK", startedAt: new Date(T0 + 2 * DAY + 5 * R.HOUR), endedAt: null }; const d = due(c, T0 + 30 * DAY); return d.length === 4 && d[0].index === 3; })());
chk("someone removed on day 4 keeps day 1-3 but is not paid for day 4 on", due(elected("SPEAKER", { endedAt: new Date(T0 + 3 * DAY + R.HOUR) }), T0 + 30 * DAY).length === 3);
chk("demo runs (SUG_TIME_SCALE) shorten the periods with the term", R.stipendsDue(elected("PRESIDENT"), { startsAt: new Date(T0), endsAt: new Date(T0 + 7 * DAY / 100) }, T0 + 7 * DAY / 100, 0.01).length === 7);

// ---- the payer ----
function fakeDb(appts, { failFor = null } = {}) {
  const ledger = new Map(), notes = [], terms = [{ id: 1, ...term, stipendsSettledAt: null }];
  const db = {
    sugTerm: { findMany: async ({ where }) => terms.filter((t) => t.stipendsSettledAt == null && +t.startsAt <= +where.startsAt.lte), updateMany: async ({ where, data }) => { const t = terms.find((x) => x.id === where.id && x.stipendsSettledAt == null); if (t) Object.assign(t, data); return { count: t ? 1 : 0 }; } },
    sugAppointment: { findMany: async () => appts },
    account: { findUnique: async () => ({ id: "acc_world" }) },
    character: { findMany: async ({ where }) => where.id.in.map((id) => ({ id, account: { id: "acc_" + id } })) },
    ledgerEntry: { findMany: async ({ where }) => where.idempotencyKey.in.filter((k) => ledger.has(k)).map((k) => ({ idempotencyKey: k })) },
    notification: { createMany: async ({ data }) => { notes.push(...data); } },
  };
  const pay = async (_db, a) => { if (failFor && a.toId === failFor) throw new Error("boom"); if (!ledger.has(a.key)) ledger.set(a.key, a); return ledger.get(a.key); };
  return { db, pay, ledger, notes, terms };
}
const appts = [{ id: 1, characterId: "p", position: "PRESIDENT", startedAt: new Date(T0 - R.HOUR), endedAt: null }, { id: 2, characterId: "h", position: "HONOURABLE_MEMBER", startedAt: new Date(T0 - R.HOUR), endedAt: null }];
{ const f = fakeDb(appts), o = { pay: f.pay, week: 3, force: true };
  let r = await payStipends(f.db, T0 + 2 * DAY + 1, o);
  chk("two days in: the President is paid twice, the Honourable Member not yet", r.paid === 2 && r.kobo === kobo(200_000) && f.ledger.size === 2 && [...f.ledger.values()].every((x) => x.toId === "acc_p" && x.fromId === "acc_world"));
  r = await payStipends(f.db, T0 + 2 * DAY + 2, o);
  chk("asking again pays nothing twice", r.paid === 0 && f.ledger.size === 2);
  chk("the term is not settled while it is running", f.terms[0].stipendsSettledAt == null);
  r = await payStipends(f.db, T0 + 7 * DAY + 1, o);
  chk("at the end of the week: the last 5 days and the Member's N70,000", r.paid === 6 && f.ledger.size === 8 && f.ledger.get("sug:pay:2:0").amount === kobo(70_000));
  chk("every player is told, and the term is settled", f.notes.length === 3 && /₦70,000/.test(f.notes.at(-1).body) && f.terms[0].stipendsSettledAt != null);
  r = await payStipends(f.db, T0 + 9 * DAY, o); chk("a settled term is never looked at again", r.paid === 0 && f.ledger.size === 8); }
{ const f = fakeDb(appts, { failFor: "acc_p" }), o = { pay: f.pay, week: 3, force: true };
  await payStipends(f.db, T0 + 8 * DAY, { ...o, });
  chk("a payment that fails keeps the term open so the next look retries it", f.terms[0].stipendsSettledAt == null && f.ledger.size === 1); }
{ const f = fakeDb(appts), a = await payStipends(f.db, T0 + 8 * DAY, { pay: f.pay, week: 3 }), b = await payStipends(f.db, T0 + 8 * DAY + 5, { pay: f.pay, week: 3 });
  chk("looks are throttled (30 seconds) unless forced", a.paid === 8 && b.paid === 0); }
process.exit(bad ? 1 : 0);