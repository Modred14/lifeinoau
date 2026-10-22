// tests/wardrobe.test.mjs: Offishall Store. (1) the catalog: prices, names, looks, and that every item maps to a real garment in a real model file;
// (2) the outfit rules: never a shirt without a bottom or a bottom without a top; (3) how a look carries clothes (cleanLook, keys, gender change, Settings cannot change clothes);
// (4) the real server service against the in-memory database: buying, not enough money, no double charge, items kept, wearing only owned and complete outfits.
import { register } from "node:module";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/wardrobe-loader.mjs", import.meta.url));
const W = await import("../lib/wardrobe.js");
const { cleanLook, adaptLook, lookKey, keepClothing, withoutWear, COLORS } = await import("../lib/look.js");
const G = await import("../lib3d/avatar/garments.js");
const svc = await import("../lib/wardrobeService.js");
const { GameError } = await import("./fixtures/wardrobe-gameService-stub.mjs");
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const refused = async (p, status) => { try { await p; return false; } catch (e) { return e instanceof GameError && (!status || e.status === status); } };

// ---------- 1. the catalog ----------
const { CATALOG, BASES, FINISHES, STYLES, itemById, fitsGender, forGender, checkWear } = W;
chk("the catalog is large", CATALOG.length >= 80);
chk("every id is unique", new Set(CATALOG.map((i) => i.id)).size === CATALOG.length);
chk("every name is unique", new Set(CATALOG.map((i) => i.name.toLowerCase())).size === CATALOG.length);
const sig = (i) => `${i.g}|${i.slot}|${Object.values(i.parts).map((p) => `${p.base}/${p.color}/${p.finish}`).join("+")}`;
chk("no two items look the same (garment, colour and fabric)", new Set(CATALOG.map(sig)).size === CATALOG.length);
chk("every colour, fabric and style is a real one", CATALOG.every((i) => STYLES[i.style] && Object.values(i.parts).every((p) => COLORS[p.color] && FINISHES[p.finish])));
const inRange = (cat, lo, hi) => CATALOG.filter((i) => i.category === cat).every((i) => i.priceNaira >= lo && i.priceNaira <= hi);
chk("shirts cost N12,000 to N25,000", inRange("shirts", 12000, 25000) && CATALOG.some((i) => i.category === "shirts"));
chk("trousers cost N18,000 to N30,000", inRange("trousers", 18000, 30000) && CATALOG.some((i) => i.category === "trousers"));
chk("skirts are priced N15,000 to N28,000 and only for women", inRange("skirts", 15000, 28000) && CATALOG.filter((i) => i.category === "skirts").every((i) => i.g === "F"));
const elite = CATALOG.filter((i) => i.category === "elite"), standardMax = Math.max(...CATALOG.filter((i) => i.category !== "elite").map((i) => i.priceNaira));
chk("every Elite piece costs at least 3x the dearest standard one", elite.every((i) => i.priceNaira >= 3 * standardMax) && elite.length >= 20);
chk("the Elite Collection has shirts, trousers, skirts and complete outfits", ["top", "bottom", "set"].every((s) => elite.some((i) => i.slot === s)) && elite.some((i) => i.parts.bottom?.base === "pencil" || i.parts.bottom?.base === "iro"));
chk("every style is sold", Object.keys(STYLES).every((s) => CATALOG.some((i) => i.style === s)));
for (const g of ["M", "F"]) {
  const list = forGender(g);
  chk(`${g}: has shirts, trousers and Elite sets`, ["shirts", "trousers", "elite"].every((c) => list.some((i) => i.category === c)) && list.some((i) => i.slot === "set"));
  chk(`${g}: every garment base exists on that body and its model file is in the repo`, list.every((i) => Object.entries(i.parts).every(([slot, p]) => BASES[slot][g][p.base] && existsSync(new URL(`../public/models/avatars/parts/outfit/${BASES[slot][g][p.base]}_${g.toLowerCase()}.glb`, import.meta.url)))));
}
chk("men are never sold a skirt", forGender("M").every((i) => !["pencil", "iro"].includes(i.parts.bottom?.base)));
chk("women are never sold a hoodie, dress shirt or kaftan", forGender("F").every((i) => !["hoodie", "shirt", "tunic"].includes(i.parts.top?.base)));
chk("a gendered item does not fit the other body", !fitsGender(itemById("b_secretary_pencil_skirt"), "M") && !fitsGender(itemById("t_unity_hoodie"), "F") && fitsGender(itemById("t_faculty_tee"), "M") && fitsGender(itemById("t_faculty_tee"), "F"));

// ---------- 2. outfit rules ----------
const ok = (ids, g) => checkWear(ids, g).ok;
chk("a shirt alone is refused (needs a bottom)", !ok(["t_faculty_tee"], "M") && /trousers or a skirt/.test(checkWear(["t_faculty_tee"], "M").reason));
chk("trousers alone are refused (need a top)", !ok(["b_classic_indigo_jeans"], "F") && /shirt or top/.test(checkWear(["b_classic_indigo_jeans"], "F").reason));
chk("a skirt alone is refused", !ok(["b_navy_pencil_skirt"], "F"));
chk("top + bottom is accepted, in any order", ok(["t_faculty_tee", "b_classic_indigo_jeans"], "M") && ok(["b_classic_indigo_jeans", "t_faculty_tee"], "M"));
chk("a woman can wear a top with a skirt", ok(["t_pearl_satin_blouse", "b_navy_pencil_skirt"], "F"));
chk("a complete outfit is accepted alone", ok(["s_gala_noir_set"], "F") && ok(["s_executive_suit_midnight"], "M"));
chk("a complete outfit cannot be mixed with another piece", !ok(["s_gala_noir_set", "t_pearl_crop_top"], "F") && !ok(["s_gala_noir_set", "s_boardroom_power_set"], "F"));
chk("two tops, two bottoms, empty and three pieces are refused", !ok(["t_faculty_tee", "t_midnight_library_tee"], "M") && !ok(["b_classic_indigo_jeans", "b_grey_wash_jeans"], "M") && !ok([], "M") && !ok(null, "M") && !ok(["t_faculty_tee", "b_classic_indigo_jeans", "b_grey_wash_jeans"], "M"));
chk("an unknown item and the wrong body are refused", !ok(["t_nope", "b_classic_indigo_jeans"], "M") && !ok(["t_faculty_tee", "b_navy_pencil_skirt"], "M") && !ok(["s_gala_noir_set"], "M"));
const parts = checkWear(["t_unity_hoodie", "b_olive_utility_chinos"], "M").parts;
chk("a valid outfit resolves to real garments from the right models", parts.top.src === "campus" && parts.bottom.src === "campus" && parts.top.base === "hoodie");
chk("every single item can always be previewed as a complete outfit", CATALOG.every((i) => ["M", "F"].filter((g) => fitsGender(i, g)).every((g) => ok(W.previewWith(i, [], null, g), g))));
chk("outfitWith needs the missing piece: none owned -> null, owned partner -> complete", W.outfitWith(itemById("t_faculty_tee"), ["t_faculty_tee"], null, "M") === null && ok(W.outfitWith(itemById("t_faculty_tee"), ["t_faculty_tee", "b_classic_indigo_jeans"], null, "M"), "M") && ok(W.outfitWith(itemById("s_gala_noir_set"), [], null, "F"), "F"));

// ---------- 3. looks, keys, Settings, gender ----------
const base = cleanLook({}, "M"), wearing = { ...base, wear: ["t_faculty_tee", "b_classic_indigo_jeans"] };
chk("cleanLook keeps a valid outfit and drops half or invalid ones", cleanLook(wearing, "M").wear?.length === 2 && !cleanLook({ ...base, wear: ["t_faculty_tee"] }, "M").wear && !cleanLook({ ...base, wear: ["t_pearl_crop_top", "b_classic_indigo_jeans"] }, "M").wear && !("wear" in cleanLook({ ...base, wear: "x" }, "M")));
chk("the picture key changes when the clothes change, and is unchanged for a look without store clothes", lookKey(cleanLook(wearing, "M"), "M") !== lookKey(base, "M") && lookKey(base, "M") === lookKey(cleanLook({ ...base, wear: undefined }, "M"), "M") && lookKey(cleanLook(wearing, "M"), "M") !== lookKey(cleanLook({ ...base, wear: ["t_midnight_library_tee", "b_classic_indigo_jeans"] }, "M"), "M"));
chk("changing gender keeps what still fits and falls back to the starter outfit otherwise", adaptLook(cleanLook(wearing, "M"), "F").wear?.length === 2 && !adaptLook(cleanLook({ ...base, wear: ["t_unity_hoodie", "b_classic_indigo_jeans"] }, "M"), "F").wear && !!adaptLook(cleanLook({ ...base, wear: ["t_unity_hoodie", "b_classic_indigo_jeans"] }, "M"), "F").outfit);
const kept = keepClothing({ ...base, hair: "x", outfit: "owambe", top: "red", bottom: "red", wear: ["s_gala_noir_set"] }, { ...base, outfit: "campus", top: "navy", bottom: "khaki" });
chk("Settings can never change clothes: outfit, colours and wear come from the stored look", kept.outfit === "campus" && kept.top === "navy" && kept.bottom === "khaki" && !("wear" in kept) && kept.hair === "x");
chk("a stored outfit survives a Settings save", keepClothing({ ...base, wear: [] }, wearing).wear.length === 2);
chk("withoutWear gives the starter look", !("wear" in withoutWear(wearing)) && withoutWear(wearing).outfit === wearing.outfit);
chk("the model fallback sees the same clothes", W.legacyFields(wearing.wear, "M").top === "white" && W.legacyFields(wearing.wear, "M").bottom === "blue" && W.legacyFields(["t_faculty_tee"], "M") === null);
chk("garment meshes are told apart by material name", G.sideOfMaterial("Top_Tee") === "top" && G.sideOfMaterial("TopDark_Hoodie") === "top" && G.sideOfMaterial("Bottom_Jeans") === "bottom" && G.sideOfMaterial("SneakerSole") === "feet" && G.sideOfMaterial("AccentTrim") === "other");
const mask = G.keepMask([{ material: "Top_Tee", cy: 1.2 }, { material: "Bottom_Jeans", cy: 0.6 }, { material: "SneakerUpper", cy: 0.05 }, { material: "AccentTrim", cy: 1.1 }, { material: "AccentTrim", cy: 0.2 }], { top: true, bottom: false });
chk("a top-only mask keeps the top and its trim, drops the bottom, shoes and low trim", mask.join() === "true,false,false,true,false");
chk("a bottom-only mask keeps the bottom, the shoes and low trim", G.keepMask([{ material: "Top_Tee", cy: 1.2 }, { material: "Bottom_Jeans", cy: 0.6 }, { material: "SneakerUpper", cy: 0.05 }, { material: "AccentTrim", cy: 0.2 }], { top: false, bottom: true }).join() === "false,true,true,true");

// ---------- 4. the server service ----------
const db = makeDb(["user", "character", "account", "ledgerEntry", "actionLog", "wardrobeItem"], {
  unique: { actionLog: ["characterId", "requestId"], ledgerEntry: ["idempotencyKey"], wardrobeItem: ["characterId", "itemId"] },
  defaults: { wardrobeItem: { get createdAt() { return new Date(); } } },
  join: { character: (r, T) => r && ({ ...r, account: T.account.find((a) => a.id === r.accountId) }) },
});
const T = db.T();
T.account.push({ id: "a1", kind: "PLAYER", balance: 5_000_000n }, { id: "a2", kind: "PLAYER", balance: 100_000_000n }, { id: "a3", kind: "PLAYER", balance: 100_000n }, { id: "sys", kind: "SYSTEM", systemName: "RETAIL", balance: 0n });
T.character.push({ id: "c1", userId: "u1", gender: "M", accountId: "a1", look: cleanLook({}, "M") }, { id: "c2", userId: "u2", gender: "F", accountId: "a2", look: cleanLook({}, "F") }, { id: "c3", userId: "u3", gender: "M", accountId: "a3", look: cleanLook({}, "M") });
const bal = (id) => T.account.find((a) => a.id === id).balance, rows = (cid) => T.wardrobeItem.filter((r) => r.characterId === cid).map((r) => r.itemId);
const rid = () => crypto.randomUUID();

let w = await svc.getWardrobe(db, "u1");
chk("a new player owns nothing and wears the starter outfit", w.owned.length === 0 && w.wear === null && w.balanceKobo === "5000000");
const r1 = await svc.buyItem(db, "u1", { itemId: "t_faculty_tee", requestId: rid(), priceNaira: 1, price: 1 }); // a browser-supplied price is ignored
chk("buying charges the catalog price exactly (N12,000) and saves the item", r1.ok && bal("a1") === 5_000_000n - 1_200_000n && rows("c1").join() === "t_faculty_tee" && T.ledgerEntry.length === 1 && T.ledgerEntry[0].amount === 1_200_000n);
const same = rid();
const r2 = await svc.buyItem(db, "u1", { itemId: "b_classic_indigo_jeans", requestId: same });
const r2b = await svc.buyItem(db, "u1", { itemId: "b_classic_indigo_jeans", requestId: same });
chk("a repeated request is harmless: charged once", r2.ok && r2b.duplicate === true && bal("a1") === 3_800_000n - 1_800_000n && rows("c1").length === 2 && T.ledgerEntry.length === 2);
chk("buying the same item again (new request) is refused and costs nothing", await refused(svc.buyItem(db, "u1", { itemId: "t_faculty_tee", requestId: rid() }), 409) && bal("a1") === 2_000_000n - 0n && rows("c1").length === 2);
chk("buying a second item keeps the first (nothing overwritten)", rows("c1").includes("t_faculty_tee") && rows("c1").includes("b_classic_indigo_jeans"));
const before = bal("a3");
chk("not enough money: refused with 402, no charge, no item, no ledger entry", await refused(svc.buyItem(db, "u3", { itemId: "t_faculty_tee", requestId: rid() }), 402) && bal("a3") === before && rows("c3").length === 0 && T.ledgerEntry.length === 2);
chk("an Elite piece is refused for a small balance too", await refused(svc.buyItem(db, "u1", { itemId: "s_aso_oke_royal_set", requestId: rid() }), 409) /* wrong body */ && await refused(svc.buyItem(db, "u1", { itemId: "s_executive_suit_midnight", requestId: rid() }), 402));
chk("an unknown item, a missing request id and the wrong body are refused", await refused(svc.buyItem(db, "u1", { itemId: "t_free_stuff", requestId: rid() }), 404) && await refused(svc.buyItem(db, "u1", { itemId: "t_ife_sky_tee" }), 400) && await refused(svc.buyItem(db, "u1", { itemId: "b_secretary_pencil_skirt", requestId: rid() }), 409));
chk("a failed purchase leaves no half-saved request behind (the same request can be retried)", T.actionLog.length === 2);

chk("wearing something not owned is refused and the look is unchanged", await refused(svc.equipOutfit(db, "u1", { ids: ["t_midnight_library_tee", "b_classic_indigo_jeans"] }), 403) && !T.character[0].look.wear);
chk("a shirt alone is refused by the server", await refused(svc.equipOutfit(db, "u1", { ids: ["t_faculty_tee"] }), 409) && !T.character[0].look.wear);
chk("trousers alone are refused by the server", await refused(svc.equipOutfit(db, "u1", { ids: ["b_classic_indigo_jeans"] }), 409) && !T.character[0].look.wear);
chk("junk input is refused", await refused(svc.equipOutfit(db, "u1", { ids: "t_faculty_tee" }), 400) && await refused(svc.equipOutfit(db, "u1", { ids: [] }), 400) && await refused(svc.equipOutfit(db, "u1", { ids: [1, 2] }), 400));
const eq = await svc.equipOutfit(db, "u1", { ids: ["b_classic_indigo_jeans", "t_faculty_tee"] });
chk("a complete owned outfit is saved into the character's look, with a new picture key", eq.ok && T.character[0].look.wear.length === 2 && eq.lookKey !== lookKey(cleanLook({}, "M"), "M") && eq.look.wear.length === 2);
w = await svc.getWardrobe(db, "u1");
chk("another device sees the same wardrobe, outfit and balance", w.owned.length === 2 && w.wear.length === 2 && w.balanceKobo === "2000000" && w.lookKey === eq.lookKey);
await svc.buyItem(db, "u2", { itemId: "s_gala_noir_set", requestId: rid() }); // N420,000: she has N1,000,000
chk("a complete outfit can be bought and worn alone, and then a second purchase keeps the first", (await svc.equipOutfit(db, "u2", { ids: ["s_gala_noir_set"] })).wear[0] === "s_gala_noir_set" && (await svc.buyItem(db, "u2", { itemId: "b_navy_pencil_skirt", requestId: rid() })).ok && rows("c2").length === 2 && T.character[1].look.wear[0] === "s_gala_noir_set");
chk("a set cannot be combined with a single piece, even if both are owned", await refused(svc.equipOutfit(db, "u2", { ids: ["s_gala_noir_set", "b_navy_pencil_skirt"] }), 409));
chk("a top and a skirt: needs a top first", await refused(svc.equipOutfit(db, "u2", { ids: ["b_navy_pencil_skirt"] }), 409));
const st = await svc.wearStarter(db, "u1");
chk("going back to the starter outfit removes nothing owned", st.wear === null && !T.character[0].look.wear && rows("c1").length === 2);
chk("a player cannot touch another player's wardrobe (the user is always the logged-in one)", rows("c2").length === 2 && rows("c3").length === 0);
chk("the spec's failure case: owning only a shirt never dresses the character in half an outfit", await refused(svc.equipOutfit(db, "u1", { ids: ["t_faculty_tee"] }), 409) && !T.character[0].look.wear);

console.log(bad ? `\n${bad} check(s) failed` : "\nAll wardrobe checks passed");
process.exit(bad ? 1 : 0);
