// Furniture catalogue, shop prices and the existing persistent room purchase/placement flow.
import assert from "node:assert/strict";
import { register } from "node:module";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));

const F = await import("../lib/furniture.js");
const { ITEMS, CATEGORIES, inShop, starterFor } = F;
const THREE = await import("three");
const { FURNITURE_MODEL_KEYS, buildFurniture } = await import("../lib3d/furnitureModels.js");
const room = await import("../lib/room.js");
const service = await import("../lib/roomService.js");
const { GameError } = await import("./fixtures/room-gameService-stub.mjs");

let bad = 0;
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const refused = async (promise, status) => { try { await promise; return false; } catch (e) { return e instanceof GameError && e.status === status; } };

chk("the shop exposes Living Room, Bedroom, Decor and Luxury Collection", ["living", "bedroom", "decor", "luxury"].every((id) => CATEGORIES.some((c) => c.id === id)));
chk("every purchasable furniture item has a valid price and shop category", Object.entries(ITEMS).filter(([k]) => inShop(k)).every(([, item]) => Number.isSafeInteger(item.price) && item.price > 0 && CATEGORIES.some((c) => c.id === item.shop) && item.w > 0 && item.d > 0));
chk("all shop catalogue items have dedicated 3D models for the room and previews", Object.keys(ITEMS).every((key) => FURNITURE_MODEL_KEYS.includes(key)));
chk("the catalogue includes table styles across affordable, mid-range and luxury prices", ITEMS.center_table_glass.price < ITEMS.center_table_wood.price && ITEMS.center_table_wood.price < ITEMS.center_table_marble.price && ITEMS.center_table_marble.price < ITEMS.center_table_designer.price);
chk("luxury items are discoverable both in their room category and Luxury Collection", ["velvet_sofa", "center_table_marble", "luxury_bed", "designer_light"].every((key) => ITEMS[key].luxury && ITEMS[key].shop !== "luxury"));
const expandedKeys = ["kitchen_island", "french_fridge", "bathtub", "shower_enclosure", "pendant_cluster", "neon_sign", "wallpaper_roll", "marble_floor", "gaming_station", "projector", "balcony_set", "garden_fountain", "aquarium", "indoor_waterfall", "shoe_rack", "washing_machine"];
chk("the expanded shop adds distinct kitchen, bath, lighting, finish, entertainment, outdoor and lifestyle items", expandedKeys.every((key) => ITEMS[key] && inShop(key) && Number.isSafeInteger(ITEMS[key].price) && ITEMS[key].price > 0));
chk("room finish purchases are marked as persistent floor or wall finishes", ["terrazzo_finish", "herringbone_floor", "marble_floor", "wallpaper_roll", "fluted_wall_panel"].every((key) => ITEMS[key].surface && ITEMS[key].finish));
// The production renderer is browser-only; a no-op canvas is enough to construct its procedural display textures in this model smoke test.
const ctx = new Proxy({}, { get: (_target, key) => typeof key === "string" ? (() => {}) : undefined });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const badModels = [];
for (const key of Object.keys(ITEMS)) {
  try {
    const g = buildFurniture(key), bounds = new THREE.Box3().setFromObject(g), size = bounds.getSize(new THREE.Vector3());
    if (!g.children.length || ![size.x, size.y, size.z].every((n) => Number.isFinite(n) && n > 0)) badModels.push(key);
    g.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material ?? [])) m.dispose?.(); });
  } catch { badModels.push(key); }
}
delete globalThis.document;
chk("every catalogue model builds real 3D geometry without runtime errors", badModels.length === 0, badModels.join(", "));
const newItems = ["luxury_bed", "premium_wardrobe", "bedside_lamp", "bedside_table_deluxe", "dressing_table", "display_shelf", "premium_rug", "loveseat", "velvet_sofa", "designer_sofa", "center_table_glass", "center_table_wood", "center_table_marble", "center_table_designer", "tv_stand", "smart_tv", "large_smart_tv", "floor_lamp", "curtain_stand", "wall_art", "framed_photos", "wall_clock", "vase", "flower_arrangement", "chandelier", "designer_light", "accent_chair"];
const placementFailures = [];
for (const hostel of ["Awo", "2-Bedroom Flat"]) {
  const spec = room.roomFor(hostel, "furniture-shop-room"), placed = [];
  for (const [key, zone] of F.starterPlan(hostel, spec.occupants)) {
    const spot = room.autoPlace(spec, placed, key, zone);
    if (spot) placed.push({ key, placed: true, id: String(placed.length), ...spot });
  }
  for (const key of newItems) {
    const spot = room.autoPlace(spec, placed, key);
    if (!spot || !room.fits(spec, placed, key, spot.x, spot.z, spot.rot)) placementFailures.push(`${hostel}:${key}`);
  }
}
chk("catalogue pieces fit and avoid doors, walls, and blocked furniture in each home layout", placementFailures.length === 0);

const models = ["character", "account", "ledgerEntry", "roomItem", "gameClock"];
const db = makeDb(models, {
  unique: { ledgerEntry: ["idempotencyKey"] },
  join: { character: (c, T) => c && ({ ...c, account: T.account.find((a) => a.characterId === c.id) }) },
});
const epoch = new Date(Date.now() - 2 * 86400_000);
db.T().gameClock.push({ id: 1, startedAt: epoch, campusEpoch: epoch });
db.T().account.push({ id: "player-account", characterId: "player", kind: "PLAYER", balance: 800_000_000n });
db.T().account.push({ id: "venues", systemName: "VENUES", kind: "SYSTEM", balance: 0n });
db.T().character.push({ id: "player", userId: "player-user", accountId: "player-account", hostel: "Awo", sessionStartWeek: 1, class: "MAPO", gender: "M", level: 1 });
db.T().character.push({ id: "poor-player", userId: "poor-user", accountId: "poor-account", hostel: "Awo", sessionStartWeek: 1, class: "MAPO", gender: "M", level: 1 });
db.T().account.push({ id: "poor-account", characterId: "poor-player", kind: "PLAYER", balance: 1_000n });

await service.getRoom(db, "player-user");
const first = await service.buyItem(db, "player-user", { key: "center_table_glass", requestId: "buy-glass-table-01" });
chk("buying charges the catalogue price and adds a placed owned item", db.T().account.find((a) => a.id === "player-account").balance === 800_000_000n - BigInt(ITEMS.center_table_glass.price) * 100n && first.items.filter((i) => i.key === "center_table_glass").length === 1 && first.items.find((i) => i.key === "center_table_glass").placed);
const second = await service.buyItem(db, "player-user", { key: "center_table_wood", requestId: "buy-wood-table-02" });
chk("a second purchase preserves the first item and adds another owned table", second.items.filter((i) => i.key.startsWith("center_table_")).length === 2);
const replay = await service.buyItem(db, "player-user", { key: "center_table_glass", requestId: "buy-glass-table-01" });
chk("replaying a purchase request does not charge or add another item", replay.duplicate && replay.items.filter((i) => i.key === "center_table_glass").length === 1);
chk("an insufficient balance rejects the purchase without charging or creating an item", await refused(service.buyItem(db, "poor-user", { key: "center_table_glass", requestId: "poor-glass-table-01" }), 402) && db.T().account.find((a) => a.id === "poor-account").balance === 1_000n && !db.T().roomItem.some((i) => i.characterId === "poor-player" && i.paid > 0n));

const owned = replay.items.find((i) => i.key === "center_table_glass"), others = replay.items.filter((i) => i.id !== owned.id);
let validTurn = null;
outer: for (let x = 0; x < replay.room.w; x++) for (let z = 0; z < replay.room.d; z++) if (room.fits(replay.room, others, owned.key, x, z, 1, owned.id)) { validTurn = { x, z, rot: 1 }; break outer; }
chk("the owned item can be rotated and repositioned to a legal open location", !!validTurn);
if (validTurn) {
  const moved = await service.placeItem(db, "player-user", { id: owned.id, ...validTurn });
  chk("the server persists the rotated furniture coordinates", moved.items.some((i) => i.id === owned.id && i.placed && i.x === validTurn.x && i.z === validTurn.z && i.rot === 1));
  const obstacle = moved.items.find((i) => i.id !== owned.id && i.placed && !ITEMS[i.key].flat);
  chk("the server rejects furniture placement that collides with another piece", obstacle && await refused(service.placeItem(db, "player-user", { id: owned.id, x: obstacle.x, z: obstacle.z, rot: 0 }), 409));
  await service.storeItem(db, "player-user", { id: owned.id });
  const saved = await service.getRoom(db, "player-user");
  chk("ownership and storage survive a fresh room read", saved.items.some((i) => i.id === owned.id && !i.placed) && saved.items.some((i) => i.id !== owned.id && i.key === "center_table_wood"));
  const placedAgain = await service.placeItem(db, "player-user", { id: owned.id });
  chk("stored furniture can be placed again without replacing other owned pieces", placedAgain.items.some((i) => i.id === owned.id && i.placed) && placedAgain.items.some((i) => i.id !== owned.id && i.key === "center_table_wood"));
}
chk("starter furniture remains unchanged while new catalogue items are added", starterFor("Awo", 2).includes("iron_bunk"));

console.log(bad ? `\n${bad} furniture check(s) failed` : "\nAll furniture checks passed");
process.exit(bad ? 1 : 0);
