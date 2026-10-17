/**
 * Family backgrounds. Kept in its own import-free file so the start screen
 * can show them without pulling the campus map into its bundle.
 */
export type Background = "nepo" | "regular" | "hustler";
export const BACKGROUNDS: Background[] = ["nepo", "regular", "hustler"];

export const BACKGROUND_INFO: Record<Background, { label: string; icon: string; blurb: string; startCash: number; allowance: number }> = {
  nepo: { label: "Nepo kid", icon: "💸", blurb: "Daddy dey send money. Fat allowance, zero stress.", startCash: 20000, allowance: 15000 },
  regular: { label: "Regular", icon: "🎒", blurb: "Normal allowance. Plan your money well.", startCash: 3000, allowance: 3000 },
  hustler: { label: "Hustler", icon: "🔥", blurb: "Small allowance. Work, collect loan, make am.", startCash: 500, allowance: 800 },
};

/** Chance of each background for a new student, out of 100. Nepo kids are rare. */
export const BACKGROUND_WEIGHTS: Record<Background, number> = { nepo: 5, regular: 60, hustler: 35 };

/** Picks a background for a new student. The server calls this; players never choose. */
export function rollBackground(random: () => number = Math.random): Background {
  const total = BACKGROUNDS.reduce((sum, b) => sum + BACKGROUND_WEIGHTS[b], 0);
  let roll = random() * total;
  for (const b of BACKGROUNDS) {
    roll -= BACKGROUND_WEIGHTS[b];
    if (roll < 0) return b;
  }
  return "regular";
}

/** Synced as a uint8 index; invalid input falls back to "regular". */
export function sanitizeBackground(v: unknown): Background {
  return typeof v === "string" && (BACKGROUNDS as string[]).includes(v) ? (v as Background) : "regular";
}

