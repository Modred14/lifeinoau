// lib/sugPay.js: what SUG office pays. The amounts and who earns what are in lib/sugRules.js (STIPEND, stipendOf, stipendsDue):
//   executive posts, Speaker, Deputy Speaker and Clerk: N100,000 a day;  each Honourable Member: N70,000 a week.
// Payment is worked out from the clock, never from a timer: payStipends() is called by advance() (every SUG request) and pays whatever has fallen due.
// It is safe to run any number of times, in any number of server processes: every payment has its own ledger key
// (`sug:pay:<appointment>:<period>`) and the ledger refuses to move the same key twice. Money comes from the WORLD account, like a wage.
import { currentWeek, serverNow } from "./clock.js";
import { transfer } from "./ledger.js";
import * as R from "./sugRules.js";

const THROTTLE_MS = 30_000; // one look every 30 seconds per server is plenty: a day is the smallest period
const lastLook = new WeakMap();
const naira = (kobo) => "₦" + (BigInt(kobo) / 100n).toLocaleString("en-NG");
const duplicate = (e) => e?.code === "P2002" || /idempotencyKey/.test(String(e?.message ?? "")); // somebody else paid this very one a moment ago: that is fine

/** Pay every stipend that has fallen due, for every term that has begun and is not settled yet. Returns { paid, kobo } (how many payments, how much). */
export async function payStipends(db, now = serverNow(), { pay = transfer, week = null, force = false } = {}) {
  const seen = lastLook.get(db);
  if (!force && seen != null && now >= seen && now - seen < THROTTLE_MS) return { paid: 0, kobo: 0n };
  lastLook.set(db, now);
  const terms = await db.sugTerm.findMany({ where: { stipendsSettledAt: null, startsAt: { lte: new Date(now) } }, select: { id: true, startsAt: true, endsAt: true } });
  const out = { paid: 0, kobo: 0n };
  if (!terms.length) return out;
  const world = await db.account.findUnique({ where: { systemName: "WORLD" } });
  if (!world) throw new Error("The WORLD account is missing: SUG stipends cannot be paid.");
  for (const term of terms) {
    const appts = await db.sugAppointment.findMany({ where: { termId: term.id }, select: { id: true, characterId: true, position: true, startedAt: true, endedAt: true } });
    const due = appts.flatMap((a) => R.stipendsDue(a, term, now).map((d) => ({ a, ...d, key: `sug:pay:${a.id}:${d.index}` })));
    let clean = true;
    if (due.length) {
      const done = new Set((await db.ledgerEntry.findMany({ where: { idempotencyKey: { in: due.map((d) => d.key) } }, select: { idempotencyKey: true } })).map((x) => x.idempotencyKey));
      const todo = due.filter((d) => !done.has(d.key));
      if (todo.length) {
        const people = await db.character.findMany({ where: { id: { in: [...new Set(todo.map((d) => d.a.characterId))] } }, select: { id: true, account: { select: { id: true } } } });
        const accountOf = new Map(people.map((c) => [c.id, c.account?.id]));
        const wk = week ?? (await currentWeek(db)), got = new Map(); // characterId -> { kobo, title, n }
        for (const d of todo) {
          const toId = accountOf.get(d.a.characterId);
          if (!toId) continue; // that player no longer exists: there is nobody to pay, and it must not hold the term open
          try {
            await pay(db, { fromId: world.id, toId, amount: d.amountKobo, memo: `SUG stipend: ${R.titleOf(d.a.position)}`, key: d.key, week: wk });
            out.paid++; out.kobo += d.amountKobo;
            const g = got.get(d.a.characterId) ?? { kobo: 0n, title: R.titleOf(d.a.position), n: 0 }; g.kobo += d.amountKobo; g.n++; got.set(d.a.characterId, g);
          } catch (e) { if (!duplicate(e)) { clean = false; console.error("sug: stipend not paid", d.key, e); } }
        }
        if (got.size) await db.notification.createMany({ data: [...got].map(([characterId, g]) => ({ characterId, kind: "SUG", body: `💰 Your SUG stipend as ${g.title} has been paid: ${naira(g.kobo)}.` })) });
      }
    }
    if (clean && now >= +term.endsAt) await db.sugTerm.updateMany({ where: { id: term.id, stipendsSettledAt: null }, data: { stipendsSettledAt: new Date(now) } });
  }
  return out;
}
