// lib/relationships.js
// Relationships with NPC love interests (fictional, generated per player). Text-only and non-graphic. Opposite-gender only: a game rule.
import { clamp } from "./engine.js";
const N = (n) => BigInt(n) * 100n;
export const STAGES = ["STRANGER", "FRIEND", "TALKING", "SNEAKY", "DATING"];
export const NEED = { FRIEND: 10, TALKING: 30, SNEAKY: 50, DATING: 70 }; // affection needed to MOVE INTO that stage
export const LABEL = { STRANGER: "Stranger", FRIEND: "Friend", TALKING: "Talking stage", SNEAKY: "Sneaky link", DATING: "Dating" };
const NAMES = { F: ["Tomi", "Ada", "Bisi", "Kemi", "Ngozi", "Zainab", "Funmi", "Chioma", "Aisha", "Folake", "Yetunde", "Amara"],
                M: ["Tunde", "Emeka", "Kunle", "Seyi", "Ibrahim", "Chidi", "Dayo", "Femi", "Bayo", "Obinna", "Yusuf", "Segun"] };
export const TRAITS = ["Caring", "Bold", "Studious", "Funny", "Fashionable"];
const LIKES = { chat: ["Studious", "Funny"], flirt: ["Bold"], gift: ["Fashionable"], date: ["Caring"] }; // liked action = +30% affection
export const GIFTS = { small: [5_000, 5], medium: [20_000, 12], big: [50_000, 22] }; // [naira, affection]
export const PREGNANCY_RISK = { close: 6, "safe-close": 1 }; // percent per time

const seed = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const prng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Three people you might meet this week. Deterministic per (player, week); always the opposite gender. */
export function candidates(characterId, gender, week) {
  const r = prng(seed(`${characterId}:${week}`)), pool = NAMES[gender === "M" ? "F" : "M"], used = new Set(), out = [];
  while (out.length < 3) { const name = pool[Math.floor(r() * pool.length)]; if (used.has(name)) continue; used.add(name); out.push({ slot: out.length, name, trait: TRAITS[Math.floor(r() * TRAITS.length)] }); }
  return out;
}
export const decayFor = (lastWeek, week) => 3 * Math.max(0, week - lastWeek - 1); // 3 points for every week with no contact
export const nextStage = (s) => STAGES[STAGES.indexOf(s) + 1] ?? null;
export const canAdvance = (rel) => { const n = nextStage(rel.stage); return !!n && rel.affection >= NEED[n]; };
const atLeast = (stage, min) => STAGES.indexOf(stage) >= STAGES.indexOf(min);

/** Resolve one interaction. Returns { error } or { affection, stats, costKobo, note, pregnancy }. */
export function resolveRelAction(c, rel, action, opts, roll, week) {
  const aff0 = Math.max(0, rel.affection - decayFor(rel.lastWeek, week));
  const extro = c.personalities.includes("Extrovert"), liked = (LIKES[action] ?? []).includes(rel.npcTrait);
  const out = (d, stats = {}, costKobo = 0n, note = null, pregnancy = false) => ({ affection: clamp(aff0 + Math.round(d * (liked && d > 0 ? 1.3 : 1))), stats: { energy: c.energy, happiness: c.happiness, popularity: c.popularity, ...stats }, costKobo, note, pregnancy });
  const need = (e) => (c.energy < e ? "You are too tired for that." : null);
  switch (action) {
    case "chat": { const e = need(5); return e ? { error: e } : out(roll(4, 8) + (extro ? 2 : 0), { energy: clamp(c.energy - 5) }, 0n, "You had a good talk."); }
    case "flirt": { const e = need(8); if (e) return { error: e };
      const p = Math.max(15, Math.min(85, 35 + c.popularity * 0.3 + c.luck * 0.2 + (extro ? 10 : 0)));
      return roll(1, 100) <= p ? out(roll(6, 12), { energy: clamp(c.energy - 8) }, 0n, "It landed. They smiled.")
        : out(-3, { energy: clamp(c.energy - 8), happiness: clamp(c.happiness - 3) }, 0n, "That was awkward."); }
    case "gift": { const g = GIFTS[opts.tier]; if (!g) return { error: "Choose a gift." }; if (rel.lastGiftWeek === week) return { error: "You already gave a gift this week." };
      return out(g[1], {}, N(g[0]), "They loved it."); }
    case "date": { if (!atLeast(rel.stage, "TALKING")) return { error: "You are not at the talking stage yet." }; if (rel.lastDateWeek === week) return { error: "You already went on a date this week." };
      const e = need(15); return e ? { error: e } : out(roll(12, 18), { energy: clamp(c.energy - 15), happiness: clamp(c.happiness + 10) }, N(15_000), "A lovely evening."); }
    case "close": case "safe-close": { if (!atLeast(rel.stage, "SNEAKY")) return { error: "You are not that close yet." }; const e = need(10); if (e) return { error: e };
      return out(roll(6, 10), { energy: clamp(c.energy - 10), happiness: clamp(c.happiness + 12) }, action === "safe-close" ? N(3_000) : 0n,
        "Things got closer.", roll(1, 100) <= PREGNANCY_RISK[action]); }
    default: return { error: "Unknown action." };
  }
}
