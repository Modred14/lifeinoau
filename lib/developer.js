// lib/developer.js: the public facts shown in the Developer phone app (components/apps/DeveloperApp.js).
// Kept in one plain module so the app and its test read the same data. Only details the developer chose to publish are listed here:
// the portfolio and email are public on https://modred.dev, and the in-game username is the name other players already see.
// Nothing here is read from an account, so no private account information can leak through this app.

export const DEVELOPER = {
  name: "Favour Omirin",
  nickname: "Modred",
  role: "Software Engineer · Full-Stack Developer",
  username: "modred", // the Life in OAU player the Message button opens (looked up by the real chat API, never faked)
  portfolio: "https://modred.dev",
  email: "favourdomirin@gmail.com",
  bio: [
    "Modred is a software engineer and a Software Engineering student at Obafemi Awolowo University (OAU). Modred builds full-stack web applications, backend systems, and interactive digital experiences.",
    "Life in OAU is one of those projects: it brings campus life into a playable 3D virtual world.",
  ],
};

/** The technologies listed on modred.dev that this profile highlights. */
export const SKILLS = ["JavaScript", "React", "Next.js", "Node.js", "PostgreSQL", "Tailwind CSS", "Prisma"];

/** Life in OAU first (it is the game you are playing), then projects that are published on modred.dev with a live demo. */
export const FEATURED = {
  name: "Life in OAU",
  tagline: "Campus life as a playable 3D world.",
  text: "A browser game that brings campus life into a playable 3D virtual world, with an in-game phone, messaging between players, and a living campus.",
  stack: ["Next.js", "React", "Three.js", "Prisma", "PostgreSQL", "Socket.IO"],
};

export const PROJECTS = [
  { name: "Nepogames", tagline: "Buy and sell game accounts. Safely.", text: "A game account marketplace that uses escrow payments, in-app seller chat, and a dispute system to protect buyers and sellers.", stack: ["Next.js", "Node.js", "PostgreSQL"], href: "https://nepogames.com" },
  { name: "Nexopra", tagline: "An opportunity scout on WhatsApp.", text: "A WhatsApp bot that delivers curated tech jobs, hackathons, fellowships, and other opportunities to its users.", stack: ["Node.js", "Baileys", "Groq AI"], href: "https://nexopra.modred.dev" },
  { name: "EscrowGo", tagline: "Escrow, not “trust me.”", text: "A peer-to-peer escrow and delivery coordination platform: payment is held until delivery is confirmed by QR scan.", stack: ["Next.js", "PostgreSQL", "Prisma"], href: "https://escrow-go.netlify.app" },
];

/** What the player reads when the developer's account cannot be opened. The server's own message is used for everything except "not found". */
export function messageErrorText(res) {
  if (res?.status === 404) return `The developer's account (${DEVELOPER.username}) could not be found right now, so no conversation was opened. Please try again later.`;
  return res?.error || "Could not reach the developer right now. Please try again.";
}
