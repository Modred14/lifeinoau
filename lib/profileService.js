// lib/profileService.js
// A player's own profile, character appearance, saved preferences and account. Everything is decided here on the server: the browser only sends choices.
// The saved appearance lives in ONE place (Character.gender + Character.look). Every screen (home room, map, buildings, other players' views) reads it from there.
import { GameError, getProfile } from "./gameService.js";
import { check, hash } from "./auth.js";
import { cleanLook, adaptLook, lookKey, keepClothing } from "./look.js";
import { cleanSettings, settingsOf } from "./settings.js";
import { startKind } from "./relationships.js";
import { cleanName, nameError, hostelForGender, genderChangeBlock, RENAME_COOLDOWN_MS, RELATION_KINDS_BLOCKING } from "./profileRules.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const publicId = (id) => id.slice(-8); // the same short id other players see (see lib/travelService.js)

/** Lock the player's row for the rest of the transaction (one change at a time) and return it. Cosmetic changes work for everyone: jailed, suspended or expelled players included. */
async function lockCharacter(tx, userId) {
  const base = await tx.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id=${base.id} FOR UPDATE`;
  return tx.character.findUnique({ where: { id: base.id } });
}

/** The facts that decide whether the gender may change. */
async function genderFacts(db, c) {
  const [bond, preg] = await Promise.all([
    db.bond.findFirst({ where: { kind: { in: RELATION_KINDS_BLOCKING }, OR: [{ lowId: c.id }, { highId: c.id }] }, select: { id: true } }),
    db.pregnancy.findFirst({ where: { characterId: c.id, status: { in: ["PENDING", "KEPT", "UNRESOLVED"] } }, select: { id: true } }),
  ]);
  return { sleeping: !!c.sleepingSince, romantic: !!bond, pregnant: !!preg || (c.dependents ?? 0) > 0 };
}

const lastRename = (db, characterId) => db.auditLog.findFirst({ where: { action: "PLAYER_RENAME", actorId: characterId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });

/** Everything the Settings screen shows, in one read. */
export async function getSettingsView(db, userId) {
  const c = await db.character.findUnique({ where: { userId }, include: { user: { select: { email: true } } } });
  if (!c) throw new GameError("Create a character first.", 404);
  const [pub, facts, rename, blocks] = await Promise.all([
    getProfile(db, userId, c.name), genderFacts(db, c), lastRename(db, c.id),
    db.block.findMany({ where: { blockerId: c.id }, select: { blockedId: true } }),
  ]);
  const blockedRows = blocks.length ? await db.character.findMany({ where: { id: { in: blocks.map((b) => b.blockedId) } }, select: { name: true }, orderBy: { name: "asc" } }) : [];
  const nextRename = rename ? new Date(rename.createdAt.getTime() + RENAME_COOLDOWN_MS) : null;
  const look = cleanLook(c.look, c.gender);
  return {
    profile: { ...pub, id: publicId(c.id), email: c.user.email, look, lookKey: lookKey(look, c.gender), hostel: c.hostel, transport: c.transport, joined: c.createdAt,
      stats: { health: c.health, energy: c.energy, happiness: c.happiness, academics: c.academics, popularity: c.popularity } },
    editable: { nameChangeAvailableAt: nextRename && nextRename > new Date() ? nextRename.toISOString() : null, genderBlock: genderChangeBlock(facts) },
    settings: settingsOf(c),
    blocked: blockedRows.map((r) => r.name),
  };
}

/** Change the character's name. Same rules as creating one, case-insensitively unique, and once a week. */
export async function saveName(db, userId, rawName) {
  const name = cleanName(rawName), bad = nameError(name);
  if (bad) throw new GameError(bad);
  try {
    return await db.$transaction(async (tx) => {
      const c = await lockCharacter(tx, userId);
      if (name === c.name) return { name: c.name, changed: false };
      const caseOnly = name.toLowerCase() === c.name.toLowerCase();
      if (!caseOnly) {
        const last = await lastRename(tx, c.id);
        if (last && Date.now() - last.createdAt.getTime() < RENAME_COOLDOWN_MS) {
          const when = new Date(last.createdAt.getTime() + RENAME_COOLDOWN_MS).toLocaleDateString("en-NG", { day: "numeric", month: "long" });
          throw new GameError(`You can change your name once a week. Next change: ${when}.`, 429);
        }
        if (await tx.character.findFirst({ where: { id: { not: c.id }, name: { equals: name, mode: "insensitive" } }, select: { id: true } })) throw new GameError("That name is taken.", 409);
      }
      await tx.character.update({ where: { id: c.id }, data: { name } });
      if (!caseOnly) await tx.auditLog.create({ data: { actorId: c.id, action: "PLAYER_RENAME", target: c.id, detail: { from: c.name, to: name } } });
      return { name, changed: true };
    });
  } catch (e) {
    if (e.code === "P2002") throw new GameError("That name is taken.", 409);
    throw e;
  }
}

/** Save gender + look together, in one write, so no screen can ever see a woman's hair on a man's body. Nothing else about the player changes, except the details that depend on gender (below). */
export async function saveAppearance(db, userId, { gender, look }) {
  if (gender != null && !["M", "F"].includes(gender)) throw new GameError("Choose a valid body type.");
  return db.$transaction(async (tx) => {
    const c = await lockCharacter(tx, userId), next = gender ?? c.gender, switching = next !== c.gender, prevHostel = c.hostel, prevGender = c.gender;
    if (switching) {
      const why = genderChangeBlock(await genderFacts(tx, c));
      if (why) throw new GameError(why, 409);
    }
    const saved = cleanLook(adaptLook(keepClothing(look ?? c.look, c.look), next), next), data = { look: saved }; // clothes are never changed here: only the Offishall wardrobe changes them (lib/wardrobeService.js)
    let hostel = c.hostel;
    if (switching) {
      data.gender = next;
      hostel = hostelForGender(c.hostel, next); // a school hall is swapped for its equal on the other side; rent, room size and class rules are unchanged
      if (hostel !== prevHostel) data.hostel = hostel;
      // Friendships follow the new gender: opposite genders are "talking", the same gender are besties (lib/relationships.js). Affection, history and dates are kept.
      const bonds = await tx.bond.findMany({ where: { OR: [{ lowId: c.id }, { highId: c.id }] } });
      const others = bonds.length ? await tx.character.findMany({ where: { id: { in: bonds.map((b) => (b.lowId === c.id ? b.highId : b.lowId)) } }, select: { id: true, gender: true } }) : [];
      const genderOf = new Map(others.map((o) => [o.id, o.gender]));
      for (const b of bonds) {
        const og = genderOf.get(b.lowId === c.id ? b.highId : b.lowId); if (!og) continue;
        if (b.kind === "TALKING" || b.kind === "BESTIE") { const kind = startKind(next, og); if (kind !== b.kind) await tx.bond.update({ where: { id: b.id }, data: { kind } }); }
        else if (b.kind === "EX" && b.prevKind && (prevGender === og) !== (next === og)) await tx.bond.update({ where: { id: b.id }, data: { prevKind: null } }); // a reconciliation must not revive a bond the new genders cannot have
      }
    }
    await tx.character.update({ where: { id: c.id }, data });
    return { gender: next, look: saved, lookKey: lookKey(saved, next), hostel, hostelMoved: hostel !== prevHostel, previousHostel: prevHostel };
  });
}

/** Save preferences. `patch` may be partial; it is merged onto what is stored and validated key by key. */
export async function saveSettings(db, userId, patch) {
  return db.$transaction(async (tx) => {
    const c = await lockCharacter(tx, userId), next = cleanSettings(patch, settingsOf(c));
    await tx.character.update({ where: { id: c.id }, data: { settings: next } });
    return { settings: next };
  });
}

/** Change the password. The current password must be right. (Other devices stay signed in until their login expires: sessions are signed cookies, not stored.) */
export async function changePassword(db, userId, { current, next }) {
  const pw = String(next ?? "");
  if (pw.length < 8) throw new GameError("The new password must be at least 8 characters.");
  if (pw.length > 200) throw new GameError("That password is too long.");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !(await check(String(current ?? ""), u.passwordHash))) throw new GameError("Your current password is not right.", 403);
  if (pw === String(current)) throw new GameError("Choose a password you have not used just now.");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hash(pw) } });
  return { ok: true };
}

/** Change the login email. Needs the current password. */
export async function changeEmail(db, userId, { password, email }) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 200) throw new GameError("Enter a valid email address.");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !(await check(String(password ?? ""), u.passwordHash))) throw new GameError("Your password is not right.", 403);
  if (u.email === e) return { email: e, changed: false };
  const taken = await db.user.findUnique({ where: { email: e }, select: { id: true } });
  if (taken && taken.id !== userId) throw new GameError("That email is already registered.", 409);
  try { await db.user.update({ where: { id: userId }, data: { email: e } }); }
  catch (err) { if (err.code === "P2002") throw new GameError("That email is already registered.", 409); throw err; }
  return { email: e, changed: true };
}
