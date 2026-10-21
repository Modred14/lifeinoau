// lib/clubService.js
// Server side of the nightclubs (the price list and the rules are in lib/clubs.js).
//
// How a purchase goes (every kind: spray, drink, a drink for a friend, package, buyout, experience)
//   1. the player's row is locked (one thing at a time), and a repeat of the same requestId is answered, never charged again;
//   2. the player must really be INSIDE this club (their last reported position, which is the server's, not the browser's) and the club must be OPEN;
//   3. the price comes from lib/clubs.js. The browser only says WHAT it wants (an item id; for spraying, an amount that must be one of the allowed ones);
//   4. the money moves through the existing ledger (lib/ledger.js) to the VENUES account, in the SAME database transaction as the ClubTransaction row,
//      the floor event the other players will see, the VIP/buyout rows and the mood change. Any failure rolls all of it back: no half-purchases;
//   5. only after that does the answer go back, and only that answer makes the screen play the show.
// Other players see the show because it is a ClubEvent row they read every few seconds (the realtime server only carries chat). Nobody can ask for
// an effect without paying: the only code that writes a ClubEvent is the transaction above.
import { serverNow, dayWindow } from "./clock.js";
import { transferInTx, InsufficientFunds } from "./ledger.js";
import { GameError, loadLocked, start as startWeek, needReq } from "./gameService.js";
import { placeOf } from "./travel.js";
import { apply } from "./activities.js";
import { cached, scopeOf } from "./cache.js";
import { CLUBS, CLUB_IDS, isClub, clubStatus, closedMessage, validSpend, MIN_SPEND, MAX_SPEND, fxLevel, tierOf, drinkById, packageById, buyoutTier, buyoutPrice, experienceById,
  KINDS, KIND_IDS, FX_STATS, CLUB_BUDGET, EVENT_TTL_MS, SPRAY_SECONDS } from "./clubs.js";

const KOBO = 100n, MIN = 60_000, FRESH_MS = 45_000; // a position older than this and the player is not "in the club" any more
export const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");
const need = (cond, msg, status = 409) => { if (!cond) throw new GameError(msg, status); };
const clockText = (ms) => new Date(ms).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });
const minsLeft = (ms) => Math.max(1, Math.ceil(ms / MIN));

// ------------------------------------------------------------------------------------------------ what a purchase turns into
/** The visual layers (client: lib3d/interiors/clubFx.js) for a show level and, for bottles, the bottle style. Layers only ever ADD as the price rises. */
function partsFor(kind, level, style) {
  const p = [];
  if (kind === "SPRAY") { p.push("spray", "banner"); if (level >= 4) p.push("spotlight"); if (level >= 5) p.push("confetti"); }
  else if (kind === "DRINK" || kind === "GIFT_DRINK" || kind === "PACKAGE") {
    p.push("bottle", "banner");
    if (style === "sparkler") p.push("sparkle"); if (style === "royal") p.push("spotlight", "sparkle"); if (style === "crown") p.push("spotlight", "sparkle", "confetti");
  }
  return p;
}

/** Everything a purchase needs, from the trusted config. Throws for anything unknown or out of range. `b` is the request body. */
function resolve(kind, b, club) {
  if (kind === "SPRAY") {
    const n = Number(b.amount); need(validSpend(n), `Spray between ${naira(MIN_SPEND)} and ${naira(MAX_SPEND)}, in steps of ₦1,000.`, 400);
    const level = fxLevel(n); return { kind, itemId: "spray", itemName: "Money Spraying", naira: n, level, parts: partsFor("SPRAY", level), data: { amount: n, sec: SPRAY_SECONDS[level] }, title: (who) => `${who} is spraying ${naira(n)}!` };
  }
  if (kind === "DRINK" || kind === "GIFT_DRINK") {
    const d = drinkById(b.itemId); need(d, "That drink is not on the menu.", 404); const level = fxLevel(d.priceNaira);
    return { kind, itemId: d.id, itemName: d.name, naira: d.priceNaira, level, parts: partsFor(kind, level, d.style), data: { drink: d.id, style: d.style }, drink: d,
      title: (who, to) => (to ? `${who} bought ${d.name} for ${to} (${naira(d.priceNaira)})` : `${who} ordered ${d.name} (${naira(d.priceNaira)})`) };
  }
  if (kind === "PACKAGE") {
    const p = packageById(b.itemId); need(p, "That package does not exist.", 404); const level = Math.max(4, fxLevel(p.priceNaira)), bottle = drinkById(p.bottle);
    const parts = partsFor("PACKAGE", level, p.style); if (p.id === "billionaire_package") parts.push("sweep");
    return { kind, itemId: p.id, itemName: p.name, naira: p.priceNaira, level, parts, data: { package: p.id, drink: bottle.id, style: p.style, table: p.table }, drink: bottle, pkg: p, vipMinutes: p.vipMinutes, table: p.table,
      title: (who) => `${who} bought the ${p.name} (${naira(p.priceNaira)})` };
  }
  if (kind === "BUYOUT") {
    const t = buyoutTier(b.itemId), price = buyoutPrice(club.id, b.itemId); need(t && price, "That buyout does not exist.", 404);
    return { kind, itemId: t.id, itemName: `${t.name} at ${club.name}`, naira: price, level: t.fx, parts: ["confetti", "spotlight", "banner"], data: { tier: t.id, mood: t.mood, minutes: t.minutes }, tier: t,
      title: (who) => `${who} bought out ${club.name}: ${t.name} (${naira(price)})` };
  }
  if (kind === "EXPERIENCE") {
    const x = experienceById(b.itemId); need(x, "That experience does not exist.", 404); const level = fxLevel(x.priceNaira);
    const parts = ["banner"]; if (x.id === "spotlight" || x.id === "luxury_entrance" || x.id === "big_spender") parts.push("spotlight");
    if (x.id === "luxury_entrance" || x.id === "birthday" || x.id === "private_party" || x.id === "big_spender" || x.id === "dj_set") parts.push("confetti");
    if (x.id === "birthday") parts.push("sparkle"); if (x.id === "big_spender") parts.push("gold");
    return { kind, itemId: x.id, itemName: x.name, naira: x.priceNaira, level, parts, data: { exp: x.id, table: x.table ?? null, mood: x.mood ?? null }, exp: x, vipMinutes: x.vipMinutes ?? 0, table: x.table ?? null, mood: x.mood ?? null, moodMinutes: x.moodMinutes ?? 0,
      title: (who) => ({ dj_shoutout: `DJ: shout-out to ${who}!`, spotlight: `All eyes on ${who}!`, vip_lounge: `${who} is in the VIP lounge`, luxury_entrance: `${who} just made a luxury entrance!`, birthday: `Happy birthday, ${who}! 🎂`, vip_table: `${who} reserved a VIP table`, dj_set: `${who} has the DJ: special set on!`, private_party: `${who} is throwing a private party`, big_spender: `BIG SPENDER: ${who} (${naira(x.priceNaira)})` })[x.id] ?? `${who}: ${x.name}` };
  }
  throw new GameError("Unknown purchase.", 400);
}

// ------------------------------------------------------------------------------------------------ VIP and buyout privileges (also read by lib/activityService.js)
/** The privileges `characterId` has at `clubId` right now: { vip: until|null, buyout: the active buyout row|null, ticketWaived, freeDrink }. */
export async function perksAt(tx, characterId, clubId, now = serverNow()) {
  if (!isClub(clubId)) return { vip: null, buyout: null, ticketWaived: false, freeDrink: false };
  const [vip, buyout] = await Promise.all([tx.clubVip.findFirst({ where: { characterId, clubId, until: { gt: new Date(now) } } }), tx.clubBuyout.findFirst({ where: { clubId, endsAt: { gt: new Date(now) } } })]);
  const on = !!vip || !!buyout; // a running buyout is "on the host": the party ticket and the bar are free for everyone inside
  return { vip: vip ? +new Date(vip.until) : null, buyout, ticketWaived: on, freeDrink: on };
}

// ------------------------------------------------------------------------------------------------ the purchase
const insideNow = (c, clubId, now) => c.placeId === clubId && c.inPlace === clubId && c.inAt && now - +new Date(c.inAt) <= FRESH_MS && c.inX != null && c.inZ != null;

/** What mood and popularity this purchase may still give today / this week (the caps are in lib/clubs.js CLUB_BUDGET). */
async function statGain(tx, c, level, week, now) {
  const want = FX_STATS[level] ?? FX_STATS[1], day = await dayWindow(tx, now);
  const rows = await tx.clubTransaction.findMany({ where: { characterId: c.id, gameWeek: week }, orderBy: { id: "desc" }, take: 400 });
  const got = { happiness: 0, popularity: 0 };
  for (const r of rows) { const d = r.delta ?? {}; if (+new Date(r.createdAt) >= day.start) got.happiness += d.happiness ?? 0; got.popularity += d.popularity ?? 0; }
  const d = {}; for (const [k, v] of Object.entries(want)) { const left = Math.max(0, CLUB_BUDGET[k].gain - got[k]); if (Math.min(v, left) > 0) d[k] = Math.min(v, left); }
  return d;
}

/**
 * Buy something at the club the player is standing in.
 * body: { kind: SPRAY|DRINK|GIFT_DRINK|PACKAGE|BUYOUT|EXPERIENCE, itemId, amount (SPRAY only), to (GIFT_DRINK: the friend's name), requestId }
 */
export async function purchase(db, userId, body = {}) {
  const requestId = body.requestId, kind = String(body.kind ?? ""); needReq(requestId); need(String(requestId).length <= 56, "Missing requestId.", 400); need(KIND_IDS.includes(kind), "Unknown purchase.", 400);
  const week = await startWeek(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId), now = serverNow();
      if (await tx.clubTransaction.findFirst({ where: { characterId: c.id, requestId } })) return { ok: true, duplicate: true }; // the same request again: nothing more happens
      const clubId = placeOf(c), club = CLUBS[clubId]; need(club, "You are not at a club.", 409);
      const st = clubStatus(now); need(st.open, closedMessage(club, now), 403);
      need(insideNow(c, clubId, now), "Step inside the club first, then walk a step and try again.", 409);
      const it = resolve(kind, body, club), amount = BigInt(it.naira) * KOBO, who = c.name;

      let rec = null; // a drink for a friend: who gets it, checked against the database, never against what the browser says
      if (kind === "GIFT_DRINK") {
        const name = String(body.to ?? "").trim().slice(0, 40); need(name, "Pick who the drink is for.", 400);
        rec = await tx.character.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true, placeId: true, inPlace: true, inAt: true, jailedUntil: true, expelled: true } });
        need(rec && rec.id !== c.id, "You cannot send that drink to yourself. Order it for yourself instead.", 400);
        need(rec.placeId === clubId && rec.inPlace === clubId && rec.inAt && now - +new Date(rec.inAt) <= FRESH_MS && !rec.expelled && !(rec.jailedUntil && +new Date(rec.jailedUntil) > now), `${rec.name} is not inside ${club.name} right now.`, 409);
        need(!(await tx.block.findFirst({ where: { OR: [{ blockerId: c.id, blockedId: rec.id }, { blockerId: rec.id, blockedId: c.id }] } })), `${rec.name} is not available.`, 409);
      }

      // a buyout is the one thing two people can fight over: one per club, decided under a lock that is held until this transaction ends
      let endsAt = null;
      if (kind === "BUYOUT" || it.mood) {
        await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${clubId}))) AS held`; // (a bare void result cannot be read by Prisma)
        const run = await tx.clubBuyout.findFirst({ where: { clubId, endsAt: { gt: new Date(now) } } });
        if (run) throw new GameError(`${run.hostName} has ${club.name} until ${clockText(+new Date(run.endsAt))} (${minsLeft(+new Date(run.endsAt) - now)} min left). Try again then.`, 409);
        if (kind === "BUYOUT") {
          need(st.closesAt - now >= it.tier.minutes * MIN, `${club.name} closes in ${minsLeft(st.closesAt - now)} minutes, which is shorter than this buyout. Try again tomorrow night.`, 409);
          endsAt = now + it.tier.minutes * MIN;
        }
        const lights = await tx.clubEvent.findFirst({ where: { clubId, kind: "MOOD", expiresAt: { gt: new Date(now) } } }); // someone's paid special set is playing: it is never overridden
        if (lights) throw new GameError(`Another special set is on at ${club.name} (${minsLeft(+new Date(lights.expiresAt) - now)} min left). Try again then.`, 409);
      }

      // the money: the same ledger as everything else, joined to this transaction
      const venues = await tx.account.findUnique({ where: { systemName: "VENUES" } });
      await transferInTx(tx, { fromId: c.account.id, toId: venues.id, amount, memo: `Club: ${it.itemName}`, key: `club:${c.id}:${requestId}`, week });

      // the mood and popularity it gives, cut to the daily and weekly caps
      const got = await statGain(tx, c, it.level, week, now), { stats, applied } = apply(c, got);
      if (Object.keys(applied).length) await tx.character.update({ where: { id: c.id }, data: stats });

      const row = await tx.clubTransaction.create({ data: { characterId: c.id, clubId, kind, itemId: it.itemId, itemName: it.itemName, amount, status: "COMPLETED", recipientId: rec?.id ?? null, recipientName: rec?.name ?? null, requestId, gameWeek: week, delta: applied } });

      // privileges
      const vipMin = it.vipMinutes ?? 0, until = kind === "BUYOUT" ? endsAt : vipMin ? Math.min(now + vipMin * MIN, st.closesAt) : 0;
      if (until) {
        const have = await tx.clubVip.findFirst({ where: { characterId: c.id, clubId } }), from = have && +new Date(have.until) > now ? +new Date(have.until) : now, to = kind === "BUYOUT" ? until : Math.min(from + vipMin * MIN, st.closesAt);
        if (have) await tx.clubVip.update({ where: { id: have.id }, data: { until: new Date(Math.max(to, +new Date(have.until))), source: it.itemId } });
        else await tx.clubVip.create({ data: { characterId: c.id, clubId, source: it.itemId, until: new Date(to) } });
      }
      if (kind === "BUYOUT") {
        await tx.clubBuyout.create({ data: { clubId, characterId: c.id, hostName: who, tierId: it.itemId, amount, startsAt: new Date(now), endsAt: new Date(endsAt) } });
        await tx.clubEvent.create({ data: { clubId, kind: "MOOD", fx: "mood", level: it.level, actorId: c.id, actorName: who, title: `${who} bought out ${club.name}`, data: { mood: it.tier.mood, tier: it.itemId, host: who }, x: c.inX, z: c.inZ, expiresAt: new Date(endsAt) } });
      } else if (it.mood) {
        await tx.clubEvent.create({ data: { clubId, kind: "MOOD", fx: "mood", level: it.level, actorId: c.id, actorName: who, title: it.title(who), data: { mood: it.mood, host: who }, x: c.inX, z: c.inZ, expiresAt: new Date(now + it.moodMinutes * MIN) } });
      }
      if (it.table) { // one table per person: a new one replaces the old
        await tx.clubEvent.updateMany({ where: { clubId, kind: "TABLE", actorId: c.id, expiresAt: { gt: new Date(now) } }, data: { expiresAt: new Date(now) } });
        await tx.clubEvent.create({ data: { clubId, kind: "TABLE", fx: "table", level: it.level, actorId: c.id, actorName: who, title: `${who}'s table`, data: { table: it.table }, x: c.inX, z: c.inZ, expiresAt: new Date(Math.min(now + (vipMin || 20) * MIN, st.closesAt)) } });
      }
      const show = await tx.clubEvent.create({ data: { clubId, kind: "SHOW", fx: it.parts[0] ?? "banner", level: it.level, actorId: c.id, actorName: who, targetName: rec?.name ?? null, title: it.title(who, rec?.name), x: c.inX, z: c.inZ, expiresAt: new Date(now + EVENT_TTL_MS),
        data: { ...it.data, parts: it.parts, amount: it.naira, kind, floor: c.inFloor ?? 0, ...(kind === "BUYOUT" ? { endsAt } : {}) } } });
      if (rec) await tx.notification.create({ data: { characterId: rec.id, kind: "CLUB", body: `${who} bought you ${it.itemName} at ${club.name}.` } });
      if (Math.random() < 0.05) await tx.clubEvent.deleteMany({ where: { clubId, expiresAt: { lt: new Date(now - 10 * MIN) } } }); // old rows are tidied now and then

      return { ok: true, id: String(row.id), clubId, kind, itemId: it.itemId, itemName: it.itemName, paidKobo: amount.toString(), level: it.level, tier: tierOf(it.naira).id, applied, recipient: rec?.name ?? null, eventId: String(show.id),
        vipUntil: until || null, buyoutEndsAt: endsAt, title: it.title(who, rec?.name) };
    });
  } catch (e) {
    if (e.code === "P2002") return { ok: true, duplicate: true };
    if (e instanceof InsufficientFunds) throw new GameError("You cannot afford that.", 402);
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------ what everyone in the club sees
const view = (e) => ({ id: String(e.id), kind: e.kind, fx: e.fx, level: e.level, actor: e.actorName, to: e.targetName ?? null, title: e.title, data: e.data ?? {}, x: e.x, z: e.z, at: +new Date(e.createdAt), until: +new Date(e.expiresAt) });

/** The club as it is right now (shared between everyone who asks within a second): the buyout, the VIPs, the tables, the lights and the recent shows. */
async function floorOf(db, clubId, now) {
  return cached(`club:${scopeOf(db)}:${clubId}`, 1000, async () => {
    const when = new Date(now), [buyout, vips, live, shows] = await Promise.all([
      db.clubBuyout.findFirst({ where: { clubId, endsAt: { gt: when } }, orderBy: { id: "desc" } }),
      db.clubVip.findMany({ where: { clubId, until: { gt: when } }, take: 60 }),
      db.clubEvent.findMany({ where: { clubId, kind: { in: ["TABLE", "MOOD"] }, expiresAt: { gt: when } }, orderBy: { id: "desc" }, take: 20 }),
      db.clubEvent.findMany({ where: { clubId, kind: "SHOW", createdAt: { gt: new Date(now - EVENT_TTL_MS) } }, orderBy: { id: "desc" }, take: 30 }),
    ]);
    const ids = [...new Set(vips.map((v) => v.characterId))], names = ids.length ? await db.character.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    return { buyout: buyout && { host: buyout.hostName, tier: buyout.tierId, name: buyoutTier(buyout.tierId)?.name ?? "Buyout", startsAt: +new Date(buyout.startsAt), endsAt: +new Date(buyout.endsAt) },
      vips: vips.map((v) => ({ name: nameOf.get(v.characterId) ?? "", until: +new Date(v.until), id: v.characterId })).filter((v) => v.name),
      tables: live.filter((e) => e.kind === "TABLE").map(view), mood: live.filter((e) => e.kind === "MOOD").map(view)[0] ?? null, shows: shows.map(view).reverse() };
  });
}

/**
 * The club the player is in, for the screen to poll every few seconds. `since` = the id of the last show it has already played (0 on the first call).
 * canEnter is false only for a club that is shut and that the player is not already inside: the screen then steps them back out.
 */
export async function clubState(db, userId, { at, since = 0 } = {}) {
  const c = await db.character.findUnique({ where: { userId } }); need(c, "Create a character first.", 404);
  const now = serverNow(), st = clubStatus(now), clubId = String(at ?? placeOf(c)); if (!isClub(clubId)) return { ok: true, club: null, serverNow: now };
  const club = CLUBS[clubId], inside = c.inPlace === clubId && c.placeId === clubId && !!c.inAt, floor = st.open || inside ? await floorOf(db, clubId, now) : { buyout: null, vips: [], tables: [], mood: null, shows: [] };
  const mine = floor.vips.find((v) => v.id === c.id), last = BigInt(Math.max(0, Number(since) || 0));
  return { ok: true, serverNow: now, club: { id: club.id, name: club.name, neon: club.neon }, status: { open: st.open, label: st.label, note: st.note, hours: st.hours, msToChange: st.msToChange, closesAt: st.closesAt, opensAt: st.opensAt },
    canEnter: st.open || inside, closing: st.open && st.msToChange <= 15 * MIN,
    buyout: floor.buyout, mood: floor.mood, tables: floor.tables, vips: floor.vips.map(({ name, until }) => ({ name, until })), vip: mine ? { until: mine.until } : null,
    perks: { ticketWaived: !!mine || !!floor.buyout, freeDrink: !!mine || !!floor.buyout },
    shows: floor.shows.filter((s) => BigInt(s.id) > last) };
}

// ------------------------------------------------------------------------------------------------ the Spending History
const GROUPS = { spray: ["SPRAY"], drinks: ["DRINK", "GIFT_DRINK"], vip: ["PACKAGE", "EXPERIENCE"], buyout: ["BUYOUT"] };
export const HISTORY_TYPES = Object.keys(GROUPS);
const day = (s, end) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""))) return null; const t = Date.parse(s + (end ? "T23:59:59.999Z" : "T00:00:00.000Z")); return Number.isFinite(t) ? new Date(t) : null; };

/** The player's OWN club spending: totals (from the stored, completed transactions) and one page of the list, newest first. Only the session's player is ever read. */
export async function history(db, userId, { club, type, from, to, cursor, limit = 20 } = {}) {
  const c = await db.character.findUnique({ where: { userId }, select: { id: true } }); need(c, "Create a character first.", 404);
  limit = Math.min(50, Math.max(1, Number(limit) || 20));
  const where = { characterId: c.id, status: "COMPLETED" }; // failed and cancelled attempts are never spending
  const filters = { ...where };
  if (club) { need(isClub(club), "Unknown club.", 400); filters.clubId = club; }
  if (type) { need(GROUPS[type], "Unknown type.", 400); filters.kind = { in: GROUPS[type] }; }
  const f = day(from, false), t = day(to, true); if (f || t) filters.createdAt = { ...(f ? { gte: f } : {}), ...(t ? { lte: t } : {}) };
  if (cursor) { need(/^\d{1,18}$/.test(String(cursor)), "Bad page.", 400); filters.id = { lt: BigInt(cursor) }; }

  const [groups, rows, tickets] = await Promise.all([
    db.clubTransaction.groupBy({ by: ["clubId", "kind"], where, _sum: { amount: true }, _count: { _all: true }, _max: { amount: true } }),
    db.clubTransaction.findMany({ where: filters, orderBy: { id: "desc" }, take: limit + 1 }),
    db.partyTicket.findMany({ where: { characterId: c.id }, select: { venue: true }, take: 500 }),
  ]);
  const sum = { total: 0n, count: 0, perClub: Object.fromEntries(CLUB_IDS.map((k) => [k, 0n])), perGroup: { spray: 0n, drinks: 0n, vip: 0n, buyout: 0n }, biggest: 0n };
  for (const g of groups) { const a = BigInt(g._sum.amount ?? 0), grp = KINDS[g.kind]?.group; sum.total += a; sum.count += g._count._all; if (g.clubId in sum.perClub) sum.perClub[g.clubId] += a; if (grp) sum.perGroup[grp] += a; if (BigInt(g._max.amount ?? 0) > sum.biggest) sum.biggest = BigInt(g._max.amount); }
  let biggest = null; if (sum.biggest > 0n) { const b = await db.clubTransaction.findFirst({ where: { ...where, amount: sum.biggest }, orderBy: { id: "desc" } }); if (b) biggest = { amountKobo: b.amount.toString(), itemName: b.itemName, clubId: b.clubId, at: +new Date(b.createdAt) }; }
  const nights = {}; for (const k of tickets) nights[k.venue] = (nights[k.venue] ?? 0) + 1;
  const topVenue = Object.entries(nights).sort((a, b) => b[1] - a[1])[0], topClub = topVenue ? CLUB_IDS.find((id) => CLUBS[id].venue === topVenue[0]) : null; // "visits" = party nights: the only visit record the game keeps
  const more = rows.length > limit, page = rows.slice(0, limit);
  const kobo = (v) => v.toString();
  return { ok: true,
    summary: { totalKobo: kobo(sum.total), count: sum.count, perClub: Object.fromEntries(Object.entries(sum.perClub).map(([k, v]) => [k, kobo(v)])), perGroup: Object.fromEntries(Object.entries(sum.perGroup).map(([k, v]) => [k, kobo(v)])), biggest, mostVisited: topClub ? { clubId: topClub, nights: topVenue[1] } : null },
    items: page.map((r) => ({ id: String(r.id), clubId: r.clubId, club: CLUBS[r.clubId]?.name ?? r.clubId, kind: r.kind, type: KINDS[r.kind]?.label ?? r.kind, name: r.itemName, amountKobo: r.amount.toString(), status: r.status, recipient: r.recipientName ?? null, at: +new Date(r.createdAt) })),
    next: more ? String(page[page.length - 1].id) : null };
}

export { GROUPS };