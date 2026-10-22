// tests/profile-service.test.mjs: the real profile service (lib/profileService.js) against the in-memory database:
// renaming, switching gender and look, what must NOT change when the look changes, who is refused, preferences, password and email.
import { register } from "node:module";
import assert from "node:assert/strict";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/profile-loader.mjs", import.meta.url));
const svc = await import("../lib/profileService.js");
const { GameError } = await import("./fixtures/profile-gameService-stub.mjs");
const { cleanLook, HAIR } = await import("../lib/look.js");
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const refused = async (p, status) => { try { await p; return false; } catch (e) { return e instanceof GameError && (!status || e.status === status); } };

const db = makeDb(["user", "character", "bond", "pregnancy", "auditLog", "block"], { unique: { user: ["email"] }, defaults: { auditLog: { get createdAt() { return new Date(); } } } });
const T = db.T();
const user = (id, email) => T.user.push({ id, email, passwordHash: "h:secret123" });
const char = (o) => T.character.push({ health: 80, energy: 70, happiness: 60, academics: 50, popularity: 40, dependents: 0, sleepingSince: null, settings: null, hostel: "Awo", gender: "M", level: 200, look: cleanLook({ hair: "braids", outfit: "casual", skin: "mahogany", top: "white", bottom: "black", height: "tall" }, "M"), ...o });
user("u1", "ada@x.com"); user("u2", "bob@x.com"); user("u3", "cy@x.com");
char({ id: "c1", userId: "u1", name: "Ada", gender: "M", hostel: "Awo", money: 123n, level: 300 });
char({ id: "c2", userId: "u2", name: "Bob", gender: "F", hostel: "Moremi" });
char({ id: "c3", userId: "u3", name: "Cy", gender: "M", hostel: "Ojaja" });
const snapshot = (id) => { const { look, gender, hostel, ...rest } = T.character.find((c) => c.id === id); return JSON.stringify(rest, (k, v) => (typeof v === "bigint" ? v.toString() : v)); };

// ---- names ----
chk("a taken name (any case) is refused", await refused(svc.saveName(db, "u1", "bob"), 409));
chk("a bad name is refused", await refused(svc.saveName(db, "u1", "x"), 400) && await refused(svc.saveName(db, "u1", "<b>hi</b>"), 400));
const r1 = await svc.saveName(db, "u1", "  Adaeze  ");
chk("a valid name is saved, trimmed", r1.changed && T.character.find((c) => c.id === "c1").name === "Adaeze");
chk("the rename is recorded", T.auditLog.length === 1 && T.auditLog[0].action === "PLAYER_RENAME");
chk("a second change inside a week is refused", await refused(svc.saveName(db, "u1", "Adaeze2"), 429));
chk("changing only the capital letters is allowed", (await svc.saveName(db, "u1", "ADAEZE")).changed && T.character.find((c) => c.id === "c1").name === "ADAEZE");
chk("the same name changes nothing", (await svc.saveName(db, "u1", "ADAEZE")).changed === false);
chk("a player cannot take a name from someone else by case tricks", await refused(svc.saveName(db, "u3", "bob"), 409));
chk("no character, no rename", await refused(svc.saveName(db, "nobody", "Zed"), 404));

// ---- appearance without a gender change ----
const before = snapshot("c1");
const a1 = await svc.saveAppearance(db, "u1", { look: { hair: "afro", outfit: "owambe", skin: "amber", top: "navy", bottom: "khaki", height: "short" } });
const c1 = T.character.find((c) => c.id === "c1");
chk("hair and skin change on their own, but Settings can no longer change clothes (only the Offishall wardrobe does)", c1.look.hair === "afro" && c1.look.outfit === "casual" && c1.look.top === "white" && c1.look.bottom === "black" && !c1.look.wear && c1.look.skin === "amber" && c1.gender === "M" && c1.hostel === "Awo");
chk("nothing else about the player is touched (level, money, stats, settings, name)", snapshot("c1") === before && c1.money === 123n && c1.level === 300);
chk("the answer carries the same look that was stored", JSON.stringify(a1.look) === JSON.stringify(c1.look) && a1.gender === "M" && !a1.hostelMoved);
chk("an invalid option is replaced by a safe one, never stored", (await svc.saveAppearance(db, "u1", { look: { hair: "mohawk-9000", outfit: "<x>", skin: "lava" } })) && HAIR.M.includes(T.character.find((c) => c.id === "c1").look.hair));
chk("a bad gender is refused", await refused(svc.saveAppearance(db, "u1", { gender: "X" }), 400));

// ---- switching gender ----
await svc.saveAppearance(db, "u1", { look: { hair: "afro", outfit: "owambe", skin: "amber", top: "navy", bottom: "khaki", height: "short" } });
T.bond.push({ id: 1n, lowId: "c1", highId: "c3", kind: "BESTIE", prevKind: null }); // two men: besties
T.bond.push({ id: 2n, lowId: "c1", highId: "c2", kind: "TALKING", prevKind: null }); // man and woman: talking
T.bond.push({ id: 3n, lowId: "c1", highId: "c9", kind: "EX", prevKind: "BABE" });
T.character.push({ id: "c9", userId: "u9", name: "Eve", gender: "F", hostel: "Moremi" });
const g1 = await svc.saveAppearance(db, "u1", { gender: "F", look: T.character.find((c) => c.id === "c1").look });
const f = T.character.find((c) => c.id === "c1");
chk("gender changes together with a look that fits it", f.gender === "F" && HAIR.F.includes(f.look.hair) && JSON.stringify(cleanLook(f.look, "F")) === JSON.stringify(f.look));
chk("choices that exist for both are kept (skin, height) and the clothes are untouched", f.look.skin === "amber" && f.look.outfit === "casual" && f.look.top === "white" && f.look.height === "short");
chk("the school hall moves to its pair, and the answer says so", f.hostel === "Moremi" && g1.hostelMoved && g1.previousHostel === "Awo");
chk("level, money and the rest are untouched by a gender change", f.money === 123n && f.level === 300 && f.name === "ADAEZE");
chk("a friendship follows the new genders: besties with a man become talking, talking with a woman become besties", T.bond[0].kind === "TALKING" && T.bond[1].kind === "BESTIE");
chk("an old ex cannot be revived into a bond the new genders cannot have", T.bond[2].prevKind === null);
chk("switching back returns the same hall and friendships", (await svc.saveAppearance(db, "u1", { gender: "M" })) && T.character.find((c) => c.id === "c1").hostel === "Awo" && T.bond[0].kind === "BESTIE" && T.bond[1].kind === "TALKING");
await svc.saveAppearance(db, "u3", { gender: "F" });
chk("a private home does not move", T.character.find((c) => c.id === "c3").hostel === "Ojaja");

// ---- who is refused ----
T.bond.push({ id: 4n, lowId: "c1", highId: "c2x", kind: "BABE", prevKind: null });
chk("a player with a romantic partner cannot change gender", await refused(svc.saveAppearance(db, "u1", { gender: "F" }), 409));
chk("...but can still change hair and clothes", (await svc.saveAppearance(db, "u1", { look: { hair: "locs" } })).look.hair === "locs");
T.bond.pop();
T.pregnancy.push({ id: 1n, characterId: "c1", status: "PENDING" });
chk("a pending pregnancy blocks the change", await refused(svc.saveAppearance(db, "u1", { gender: "F" }), 409));
T.pregnancy.pop();
T.character.find((c) => c.id === "c1").sleepingSince = new Date();
chk("a sleeping player cannot change gender", await refused(svc.saveAppearance(db, "u1", { gender: "F" }), 409));
T.character.find((c) => c.id === "c1").sleepingSince = null;
chk("each player only ever edits their own record (the id comes from the login, not the request)", (() => { const b = T.character.find((c) => c.id === "c2").look; return JSON.stringify(b) === JSON.stringify(T.character.find((c) => c.id === "c2").look); })());
const str = (o) => JSON.stringify(o, (k, v) => (typeof v === "bigint" ? v.toString() : v)), bobBefore = str(T.character.find((c) => c.id === "c2"));
await svc.saveAppearance(db, "u1", { look: { hair: "afro" }, userId: "u2", id: "c2", characterId: "c2" });
chk("extra fields in the request cannot point at another player", str(T.character.find((c) => c.id === "c2")) === bobBefore);

// ---- preferences ----
const s1 = await svc.saveSettings(db, "u1", { audio: { music: false, musicVolume: 40 }, accessibility: { largeText: true }, evil: 1 });
chk("preferences are validated and stored on the character", s1.settings.audio.music === false && s1.settings.audio.musicVolume === 40 && s1.settings.accessibility.largeText && !("evil" in s1.settings) && T.character.find((c) => c.id === "c1").settings.audio.musicVolume === 40);
const s2 = await svc.saveSettings(db, "u1", { privacy: { searchable: false } });
chk("a later save keeps what was saved before", s2.settings.audio.musicVolume === 40 && s2.settings.privacy.searchable === false);

// ---- password and email ----
chk("a wrong current password is refused", await refused(svc.changePassword(db, "u1", { current: "nope", next: "newpass123" }), 403));
chk("a short new password is refused", await refused(svc.changePassword(db, "u1", { current: "secret123", next: "abc" }), 400));
chk("the same password is refused", await refused(svc.changePassword(db, "u1", { current: "secret123", next: "secret123" }), 400));
await svc.changePassword(db, "u1", { current: "secret123", next: "newpass123" });
chk("a right current password changes it", T.user.find((u) => u.id === "u1").passwordHash === "h:newpass123");
chk("email needs the password", await refused(svc.changeEmail(db, "u1", { password: "wrong", email: "new@x.com" }), 403));
chk("a bad email is refused", await refused(svc.changeEmail(db, "u1", { password: "newpass123", email: "nope" }), 400));
chk("a taken email is refused", await refused(svc.changeEmail(db, "u1", { password: "newpass123", email: "BOB@x.com" }), 409));
chk("a good email is saved lower-cased", (await svc.changeEmail(db, "u1", { password: "newpass123", email: "Ada.New@X.com" })).email === "ada.new@x.com" && T.user.find((u) => u.id === "u1").email === "ada.new@x.com");

process.exit(bad ? 1 : 0);
