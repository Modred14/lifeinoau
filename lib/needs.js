// lib/needs.js
// How the player is doing, in one place: the 0-100 stats shown as needs, the one short line about the worst of them, and the mood word.
// Shared by the home screen (components/GameHome.js) and the avatar button + needs sheet on the bottom bar (components/BottomNav.js, NeedsSheet.js),
// so the two can never disagree about what "Exhausted" or "Feeling low" means.

/** [label, stat key on the character, Icon name]. Suspicion is the one stat where high is bad. */
export const NEEDS = [
  ["Health", "health", "health"],
  ["Energy", "energy", "energy"],
  ["Happiness", "happiness", "happy"],
  ["Academics", "academics", "study"],
  ["Popularity", "popularity", "social"],
  ["Suspicion", "suspicion", "eye"],
];

/** The five stats that make up the ring around the avatar (higher is better for all of them), with the colour each segment is drawn in. */
export const RING = [
  ["health", "#ff7a8a"],
  ["energy", "#5aa2ff"],
  ["happiness", "#f2b84b"],
  ["academics", "#5fe3c0"],
  ["popularity", "#b48cff"],
];

/** One short line about how the player is, from their worst stat. */
export function statusOf(c) {
  if (c.health < 25) return { tone: "bad", text: "Very sick. Rest up" };
  if (c.energy < 20) return { tone: "bad", text: "Exhausted. Go and rest" };
  if (c.suspicion >= 60) return { tone: "bad", text: "N-QRS is watching you" };
  if (c.happiness < 25) return { tone: "warn", text: "Feeling low. Call home" };
  if (c.energy < 40) return { tone: "warn", text: "Getting tired" };
  return null;
}

/** The mood word and face for the player's happiness: { text, icon, tone } (tone: "ok" | "warn" | "bad"). */
export function moodOf(c) {
  const h = Number(c?.happiness ?? 0);
  if (h >= 80) return { text: "Very happy", icon: "happy", tone: "ok" };
  if (h >= 60) return { text: "Happy", icon: "happy", tone: "ok" };
  if (h >= 40) return { text: "Okay", icon: "meh", tone: "ok" };
  if (h >= 25) return { text: "Low", icon: "meh", tone: "warn" };
  return { text: "Sad", icon: "sad", tone: "bad" };
}

/** A stat's tone for colouring its bar: low is bad for every stat except suspicion, where high is. */
export const toneOf = (key, v) => (key === "suspicion" ? (v >= 60 ? "bad" : v >= 35 ? "warn" : "ok") : v < 25 ? "bad" : v < 40 ? "warn" : "ok");
