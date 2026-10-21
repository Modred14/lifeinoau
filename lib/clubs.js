// lib/clubs.js
// Everything about the nightclubs that is DATA or a PURE RULE: opening hours, the price list, the packages, the buyouts, the spending ladder.
// The server (lib/clubService.js) trusts only this file for prices and effects; the screens read it to show the same numbers. Change a price
// or a benefit HERE and nothing else. No database, no browser APIs, so Node tests can check it.
//
// Money in this file is whole NAIRA (the database holds kobo: the service multiplies by 100). All names, prices and bottles are fictional
// in-game items for LifeInOAU's economy: they are not claims about real retail prices, and the bottles are original shapes and colours.
import { gameMinuteOfDay, nextGameTime, GAME_MINUTE_MS } from "./campus-clock.js";

// ------------------------------------------------------------------------------------------------ the clubs
/** map place id -> the club. `venue` is the name the Parties system already uses (lib/parties.js). */
export const CLUBS = {
  club_0203: { id: "club_0203", venue: "0203", name: "0203", neon: "#ff4fd8", buyout: { section: 400_000, shutdown: 2_000_000, takeover: 8_000_000 } },
  club_divas: { id: "club_divas", venue: "Royal Divas", name: "Royal Divas", neon: "#ffd24a", buyout: { section: 600_000, shutdown: 3_000_000, takeover: 10_000_000 } },
  club_quantum: { id: "club_quantum", venue: "Quantum", name: "Quantum", neon: "#38e8ff", buyout: { section: 500_000, shutdown: 2_500_000, takeover: 9_000_000 } },
};
export const CLUB_IDS = Object.keys(CLUBS);
export const isClub = (placeId) => Object.hasOwn(CLUBS, placeId);
export const clubOf = (placeId) => CLUBS[placeId] ?? null;

// ------------------------------------------------------------------------------------------------ opening hours
/** Game-clock hours (West Africa Time, see lib/campus-clock.js). All three clubs share these, so they open and close together. */
export const OPEN_HOUR = 20, CLOSE_HOUR = 5;
export const HOURS_LABEL = "8 PM – 5 AM";
const OPEN_MIN = OPEN_HOUR * 60, CLOSE_MIN = CLOSE_HOUR * 60;
const clock12 = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

/** True when the clubs are open at `now` (ms). The one rule, used by the server for every entry and every purchase. */
export const isNightTime = (now = Date.now()) => { const m = gameMinuteOfDay(now); return m >= OPEN_MIN || m < CLOSE_MIN; };

/** What to show for a club right now: { open, label, note, hours, opensAt, closesAt, msToChange }. `now` and the answer are ms. */
export function clubStatus(now = Date.now()) {
  const open = isNightTime(now), opensAt = open ? null : nextGameTime(OPEN_MIN, now), closesAt = open ? nextGameTime(CLOSE_MIN, now) : null;
  return { open, label: open ? "OPEN" : "CLOSED", note: open ? `Open until ${clock12(CLOSE_HOUR)}` : `Opens at ${clock12(OPEN_HOUR)}`, hours: HOURS_LABEL, opensAt, closesAt, msToChange: (open ? closesAt : opensAt) - now };
}
/** The text for a player who tried to get in or buy while it is shut. */
export const closedMessage = (club, now = Date.now()) => `${club?.name ?? "The club"} is closed. The clubs open from ${HOURS_LABEL}. Come back at ${clock12(OPEN_HOUR)}.`;

// ------------------------------------------------------------------------------------------------ the spending ladder
/** The smallest and the largest amount for ANY club purchase (naira). */
export const MIN_SPEND = 10_000, MAX_SPEND = 10_000_000, SPEND_STEP = 1_000;
/** basic < ₦100k <= premium < ₦1M <= luxury < ₦5M <= exclusive. A guideline for labels and effects, not a limit on any one price. */
export const LADDER = [
  { id: "basic", label: "Basic", from: 10_000, to: 100_000 },
  { id: "premium", label: "Premium", from: 100_000, to: 1_000_000 },
  { id: "luxury", label: "Luxury", from: 1_000_000, to: 5_000_000 },
  { id: "exclusive", label: "Exclusive", from: 5_000_000, to: 10_000_000 },
];
export const tierOf = (naira) => (naira >= 5_000_000 ? LADDER[3] : naira >= 1_000_000 ? LADDER[2] : naira >= 100_000 ? LADDER[1] : LADDER[0]);
/** How big the show is, 1 (a nice touch) to 5 (the whole club stops to look). Everything visual scales with it. */
export const fxLevel = (naira) => (naira >= 5_000_000 ? 5 : naira >= 2_000_000 ? 4 : naira >= 500_000 ? 3 : naira >= 50_000 ? 2 : 1);
/** True for a whole-naira amount inside the allowed range and on the step (₦1,000). */
export const validSpend = (n) => Number.isSafeInteger(n) && n >= MIN_SPEND && n <= MAX_SPEND && n % SPEND_STEP === 0;

// ------------------------------------------------------------------------------------------------ money spraying
export const SPRAY_AMOUNTS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];
/** How many real seconds the sprayer's arms are up and the notes fly, by show level. */
export const SPRAY_SECONDS = { 1: 3, 2: 4, 3: 5, 4: 7, 5: 9 };

// ------------------------------------------------------------------------------------------------ luxury drinks
/**
 * `shape` picks a bottle profile in lib3d/interiors/clubFx.js (a lathe profile: no model files, so nothing heavy is loaded).
 * `style` is how it is brought out: tray (one waiter), sparkler (a sparkler on the bottle), royal (a spotlight column), crown (the full show).
 */
export const DRINKS = [
  { id: "hennessy", name: "Hennessy", priceNaira: 1_000_000, kind: "Cognac", shape: "cognac", body: "#7a3d12", label: "#e9d9b0", cap: "#c9a227", glass: 0.78, style: "tray", blurb: "A smooth, warm cognac. The classic order." },
  { id: "martell", name: "Martell", priceNaira: 2_000_000, kind: "Cognac", shape: "cognac", body: "#8a5a1e", label: "#2b5fa8", cap: "#d8d2bf", glass: 0.8, style: "tray", blurb: "Table service with a proper pour." },
  { id: "don_julio_1942", name: "Don Julio 1942 Tequila", priceNaira: 2_000_000, kind: "Tequila", shape: "squat", body: "#d9b25a", label: "#f1ead7", cap: "#16161a", glass: 0.55, style: "tray", blurb: "Aged tequila in a heavy, round bottle." },
  { id: "dom_perignon", name: "Dom Pérignon Champagne", priceNaira: 3_000_000, kind: "Champagne", shape: "champagne", body: "#1d4a2c", label: "#f4efe0", cap: "#c9a227", glass: 0.92, style: "sparkler", blurb: "Champagne, brought out with sparklers." },
  { id: "clase_azul", name: "Clase Azul Tequila", priceNaira: 5_000_000, kind: "Tequila", shape: "ceramic", body: "#1f4fbf", label: "#f1ead7", cap: "#c3c8d4", glass: 1, style: "royal", exclusive: true, blurb: "A hand-painted blue bottle. Exclusive." },
  { id: "ace_of_spades", name: "Ace of Spades Champagne", priceNaira: 5_000_000, kind: "Champagne", shape: "champagne", body: "#c9a227", label: "#15151a", cap: "#15151a", glass: 1, metal: true, style: "royal", exclusive: true, blurb: "A metal-finish bottle with its own announcement." },
  { id: "louis_xiii", name: "Louis XIII Cognac", priceNaira: 10_000_000, kind: "Cognac", shape: "decanter", body: "#7a2f0c", label: "#c9a227", cap: "#e2c15a", glass: 0.7, style: "crown", exclusive: true, blurb: "The ultimate bottle. The whole club stops." },
];
export const drinkById = (id) => DRINKS.find((d) => d.id === id) ?? null;

// ------------------------------------------------------------------------------------------------ VIP privileges
/**
 * What "VIP" actually means in the game (the server applies exactly these; see lib/clubService.js and lib/activityService.js):
 *   ticket    the weekly party ticket is not needed for the dance floor, the VIP room and the bar of THIS club while VIP
 *   freeDrink the bar's "Order a drink" costs nothing while VIP
 *   badge     a gold VIP tag next to your name in the club's guest list, seen by everyone inside
 */
export const VIP_PERKS = ["No party ticket needed at this club", "Free drinks at the bar", "Gold VIP badge in the guest list"];

// ------------------------------------------------------------------------------------------------ bottle-service packages
/** `vipMinutes` is real time (the game clock is 1:1 with real time); VIP always ends when the club closes. */
export const PACKAGES = [
  { id: "vip_package", name: "VIP PACKAGE", priceNaira: 3_000_000, vipMinutes: 30, bottle: "dom_perignon", style: "sparkler", table: "vip",
    benefits: ["A Dom Pérignon-style bottle brought to you with sparklers", "A VIP table reserved at your spot for 30 minutes", "A purchase announcement in the club", "30 minutes of VIP privileges"] },
  { id: "royal_package", name: "ROYAL PACKAGE", priceNaira: 5_000_000, vipMinutes: 45, bottle: "clase_azul", style: "royal", table: "royal",
    benefits: ["A royal bottle presentation with a spotlight column", "A royal table with a glowing top and a gold cloth for 45 minutes", "A premium announcement across the club", "45 minutes of VIP privileges"] },
  { id: "billionaire_package", name: "BILLIONAIRE PACKAGE", priceNaira: 10_000_000, vipMinutes: 60, bottle: "louis_xiii", style: "crown", table: "billionaire",
    benefits: ["The full Louis XIII presentation", "A gold spotlight on your table, sweeping lights and confetti", "A premium announcement across the club", "60 minutes of VIP privileges"] },
];
export const packageById = (id) => PACKAGES.find((p) => p.id === id) ?? null;

// ------------------------------------------------------------------------------------------------ club buyouts
/** Real minutes the buyout lasts. 5 to 10, as designed. Prices are per club (CLUBS[...].buyout). */
export const BUYOUT_TIERS = [
  { id: "section", name: "Private Section", minutes: 5, fx: 3, mood: "lounge", summary: "A roped-off section, lounge lighting and a host banner for 5 minutes." },
  { id: "shutdown", name: "Shut Down The Club", minutes: 7, fx: 4, mood: "shutdown", summary: "Full club lighting, spotlights and confetti, and the bar is on you for 7 minutes." },
  { id: "takeover", name: "Billionaire Takeover", minutes: 10, fx: 5, mood: "takeover", summary: "Gold lights, a laser show and a club-wide banner for 10 minutes. The bar is on you." },
];
export const buyoutTier = (id) => BUYOUT_TIERS.find((t) => t.id === id) ?? null;
export const buyoutPrice = (clubId, tierId) => CLUBS[clubId]?.buyout?.[tierId] ?? null;
/** What the buyout does and does not do, shown BEFORE the player pays. */
export const BUYOUT_TERMS = [
  "Everyone inside gets free drinks at the bar and the party ticket is waived for the duration.",
  "You get VIP privileges and the host banner with your name and a countdown.",
  "The doors stay open: nobody is locked out, locked in, moved or disconnected.",
  "Only one buyout can run at a club at a time. It ends by itself and the club goes back to normal.",
];

// ------------------------------------------------------------------------------------------------ other club experiences
/** Every one has a real effect (see EXPERIENCE_EFFECT in lib/clubService.js). `vipMinutes` > 0 grants VIP; `mood` changes the club's lights for `moodMinutes`. */
export const EXPERIENCES = [
  { id: "dj_shoutout", name: "DJ Shout-out", priceNaira: 10_000, icon: "club", summary: "The DJ calls your name over the music.", effect: "A banner with your name appears for everyone in the club." },
  { id: "spotlight", name: "Spotlight Announcement", priceNaira: 100_000, icon: "sparkle", summary: "A spotlight finds you and the club hears about it.", effect: "A spotlight follows you for 30 seconds and the club gets an announcement." },
  { id: "vip_lounge", name: "VIP Lounge Access", priceNaira: 150_000, icon: "club", vipMinutes: 30, summary: "Thirty minutes of VIP privileges.", effect: "VIP privileges for 30 minutes: no ticket, free drinks, gold badge." },
  { id: "luxury_entrance", name: "Luxury Entrance", priceNaira: 250_000, icon: "sparkle", summary: "Confetti, a spotlight and an announcement as you arrive.", effect: "A confetti burst and a spotlight on you, with a club announcement." },
  { id: "birthday", name: "Birthday Celebration", priceNaira: 500_000, icon: "party", summary: "The club celebrates you.", effect: "Confetti and balloons, a birthday banner, and a bottle-service sparkler at your spot." },
  { id: "vip_table", name: "VIP Table Reservation", priceNaira: 750_000, icon: "club", vipMinutes: 20, table: "vip", summary: "A table of your own, with bottle service, for 20 minutes.", effect: "A reserved VIP table with your name at your spot for 20 minutes, plus 20 minutes of VIP privileges." },
  { id: "dj_set", name: "Special DJ Experience", priceNaira: 1_000_000, icon: "club", mood: "djset", moodMinutes: 3, summary: "The DJ plays your set and the lights follow it.", effect: "Strobing DJ-set lights across the whole club for 3 minutes, and your name on the banner." },
  { id: "private_party", name: "Private Party Package", priceNaira: 2_000_000, icon: "party", mood: "party", moodMinutes: 5, vipMinutes: 10, summary: "Party lights, confetti and VIP for ten minutes.", effect: "Party lighting for 5 minutes, confetti, and 10 minutes of VIP privileges." },
  { id: "big_spender", name: "Big Spender Celebration", priceNaira: 5_000_000, icon: "forbes", vipMinutes: 30, summary: "A golden celebration for the biggest spenders.", effect: "A golden confetti storm and a gold spotlight, a club-wide announcement, and 30 minutes of VIP privileges." },
];
export const experienceById = (id) => EXPERIENCES.find((x) => x.id === id) ?? null;

// ------------------------------------------------------------------------------------------------ transaction kinds
/** What the history calls each kind of purchase, and which summary line it belongs to. */
export const KINDS = {
  SPRAY: { label: "Money Spraying", group: "spray" },
  DRINK: { label: "Drink", group: "drinks" },
  GIFT_DRINK: { label: "Drink for a friend", group: "drinks" },
  PACKAGE: { label: "VIP Package", group: "vip" },
  BUYOUT: { label: "Club Buyout", group: "buyout" },
  EXPERIENCE: { label: "Club Experience", group: "vip" },
};
export const KIND_IDS = Object.keys(KINDS);

// ------------------------------------------------------------------------------------------------ what a purchase does to the player
/** Mood and popularity from a night of spending, by show level. Capped per day / week (CLUB_BUDGET) so it cannot be farmed. */
export const FX_STATS = { 1: { happiness: 1 }, 2: { happiness: 2, popularity: 1 }, 3: { happiness: 3, popularity: 1 }, 4: { happiness: 4, popularity: 2 }, 5: { happiness: 5, popularity: 3 } };
export const CLUB_BUDGET = { happiness: { per: "day", gain: 8 }, popularity: { per: "week", gain: 3 } };

// ------------------------------------------------------------------------------------------------ how long things stay on the floor
/** A show event stays in the feed this long (ms). A player who joins a few seconds late still sees it; an old one is never replayed. */
export const EVENT_TTL_MS = 20_000;
/** A server-side cap on how many events one club keeps, so a busy night cannot grow the table without limit. */
export const EVENT_KEEP = 400;
export { GAME_MINUTE_MS };