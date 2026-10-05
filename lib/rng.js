// lib/rng.js
import { randomInt } from "node:crypto";
// Server-side only. Uses the OS CSPRNG, so the client can never influence the draw.
export const drawClass = () => { const r = randomInt(100); return r < 60 ? "MAPO" : r < 90 ? "LAPO" : "NEPO"; };
export const roll = (min, max) => randomInt(min, max + 1);
export const lifestyle = (personalities) => ({
  happiness: roll(50, 75), academics: roll(35, 60), popularity: roll(5, 30), luck: roll(30, 90),
  riskTolerance: Math.min(100, roll(20, 80) + (personalities.includes("Shana") ? 15 : 0)),
});
