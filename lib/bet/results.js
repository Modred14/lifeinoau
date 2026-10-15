// lib/bet/results.js  (SERVER ONLY: it needs the secret)
// The match results. A result is a pure function of (secret, fixture id), so nothing needs storing and nobody can know it early.
// Goals are drawn from the SAME Poisson model the odds come from, so the bookmaker's margin is the real long-run edge.
import { createHmac } from "node:crypto";
import { parseId, minuteAt, MATCH_MS, phaseAt } from "./fixtures.js";
import { scoreProbs } from "./markets.js";

const secret = () => process.env.BET_SECRET || process.env.SESSION_SECRET || "dev-only-secret";
function stream(id) {
  // counter mode: block n = HMAC(secret, id|n), four bytes at a time, so any number of draws stay unpredictable without the secret
  let n = 0, buf = null, at = 32;
  return () => {
    if (at >= 32) { buf = createHmac("sha256", secret()).update(`bet|${id}|${n++}`).digest(); at = 0; }
    const v = buf.readUInt32BE(at) / 4294967296; at += 4; return v;
  };
}
const cache = new Map();
/** { h, a, goals: [{ m, side }] sorted by minute } for a fixture id. */
export function resultOf(id) {
  if (cache.has(id)) return cache.get(id);
  const fx = parseId(id); if (!fx) return null;
  const u = stream(id), g = scoreProbs(fx);
  let r = u(), h = 0, a = 0;
  outer: for (h = 0; h < g.length; h++) for (a = 0; a < g[h].length; a++) { r -= g[h][a]; if (r <= 0) break outer; }
  h = Math.min(h, g.length - 1); a = Math.min(a, g[0].length - 1);
  const goals = [];
  for (let k = 0; k < h; k++) goals.push({ m: 1 + Math.floor(u() * 90), side: "h" });
  for (let k = 0; k < a; k++) goals.push({ m: 1 + Math.floor(u() * 90), side: "a" });
  goals.sort((x, y) => x.m - y.m);
  const res = { h, a, goals };
  if (cache.size > 500) cache.clear();
  cache.set(id, res);
  return res;
}

/** What the world knows about a fixture at `now`: phase, minute and the score so far (goals appear as their minute passes). */
export function liveOf(id, now) {
  const fx = parseId(id), res = resultOf(id); if (!fx) return null;
  const ph = phaseAt(fx.ko, now);
  if (ph === "pre") return { id, ph };
  const m = minuteAt(fx.ko, now);
  const seen = ph === "ft" ? res.goals : res.goals.filter((x) => x.m <= m);
  return { id, ph, m, h: seen.filter((x) => x.side === "h").length, a: seen.filter((x) => x.side === "a").length };
}
export const isFinished = (id, now) => { const fx = parseId(id); return !!fx && now >= fx.ko + MATCH_MS; };