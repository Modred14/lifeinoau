// lib/fightSim.js
// The real-time brawl with a lecturer. Pure: no browser, no three.js, no database, so it can be tested in Node.
// The 3D scene (lib3d/lectureScene.js) only DRAWS what this simulation says. Randomness is injected.
//
// Two fighters, always in reach of each other. Moves have a wind-up (you can see them coming), a strike frame and a recovery.
// A landed hit staggers the victim and cancels what they were doing, so quick hits keep a lecturer from swinging.
// Block (hold) takes most of the damage, dodge (short, with a cooldown) makes a swing miss.
// "Auto" mode plays the player's side by itself, and the player can take over (or hand back) at any moment.

export const MOVES = {
  punch: { wind: 0.12, total: 0.38, dmg: 7 },
  kick: { wind: 0.22, total: 0.62, dmg: 12 },
  swing: { wind: 0.5, total: 0.95, dmg: 12 }, // the lecturer
};
export const STAGGER = 0.3; // seconds a landed hit leaves the victim helpless
export const ARMOR = 1.0; // seconds after a stagger when the next hit still hurts but cannot stagger (no endless stun-lock)
export const DODGE = { total: 0.4, safe: 0.34, cooldown: 0.9 };
export const BLOCK_TAKES = 0.2; // share of damage that gets through a block
export const TIME_LIMIT = 45; // seconds; then whoever has more health left wins

/** How strong the lecturer is, from the course's difficulty (about 0.8 to 1.6): health and damage. */
export const lecturerStats = (difficulty = 1) => ({
  maxHp: Math.round(80 + 40 * Math.max(0, Math.min(1, (difficulty - 0.8) / 0.7))),
  dmgMul: 0.75 + 0.4 * Math.max(0, Math.min(1.2, difficulty - 0.8)) / 0.7,
  pace: 0.85 + 0.3 * Math.max(0, Math.min(1, (difficulty - 0.8) / 0.7)), // 1 = how fast he starts the next swing
});
/** The player's health bar from the character's health stat (0 to 100). */
export const playerMaxHp = (health = 80) => Math.round(60 + 0.4 * Math.max(0, Math.min(100, health)));

const fighter = (id, maxHp) => ({ id, hp: maxHp, maxHp, act: "idle", move: null, t: 0, hitDone: false, cd: 0.25, armor: 0, dodgeCd: 0, autoBlock: false, autoDodge: false });

/**
 * createFight({ difficulty, health, rng })
 * sim.update(dt, input) with input = { punch, kick, dodge } (true on the frame it is pressed) and { block } (true while held).
 * Returns the events of that step: { type: "start", by, move } | { type: "strike", by, move, dmg, crit, result: "hit"|"block"|"dodge" } | { type: "ko", who } | { type: "end", winner }.
 * Read sim.p and sim.l (the fighters), sim.over, sim.winner, sim.auto (set it to hand the player's side to the computer).
 */
export function createFight({ difficulty = 1, health = 80, rng = Math.random, auto = true } = {}) {
  const ls = lecturerStats(difficulty);
  const sim = {
    p: fighter("p", playerMaxHp(health)), l: fighter("l", ls.maxHp), time: 0, over: false, winner: null, auto,
    stats: { landed: 0, taken: 0, blocks: 0, dodges: 0, autoTime: 0 },
    update, report,
  };
  const other = (f) => (f.id === "p" ? sim.l : sim.p);
  const r = (a, b) => a + rng() * (b - a);

  function start(f, move, events) { f.act = "move"; f.move = move; f.t = 0; f.hitDone = false; events.push({ type: "start", by: f.id, move }); }
  function setIdle(f, cd) { f.act = "idle"; f.move = null; f.t = 0; f.cd = cd; }

  function strike(f, events) {
    const d = other(f), m = MOVES[f.move];
    if (d.act === "ko") return;
    const crit = rng() < 0.15, mul = f.id === "l" ? ls.dmgMul : 1;
    let dmg = Math.round(m.dmg * mul * r(0.85, 1.15) * (crit ? 1.6 : 1)), result = "hit";
    if (d.act === "dodge" && d.t < DODGE.safe) { events.push({ type: "strike", by: f.id, move: f.move, dmg: 0, crit: false, result: "dodge" }); if (d.id === "p") sim.stats.dodges++; return; }
    if (d.act === "block") { dmg = Math.max(1, Math.round(dmg * BLOCK_TAKES)); result = "block"; if (d.id === "p") sim.stats.blocks++; }
    d.hp = Math.max(0, d.hp - dmg);
    if (f.id === "p") sim.stats.landed++; else sim.stats.taken++;
    events.push({ type: "strike", by: f.id, move: f.move, dmg, crit: crit && result === "hit", result });
    if (d.hp <= 0) { d.act = "ko"; d.move = null; d.t = 0; sim.over = true; sim.winner = d.id === "l" ? "p" : "l"; events.push({ type: "ko", who: d.id }); return; }
    if (result === "hit" && d.armor <= 0) { d.act = "hit"; d.move = null; d.t = 0; d.cd = 0; }
  }

  function autoInput() {
    const p = sim.p, l = sim.l, inp = {};
    if (l.act === "move" && l.t < 0.05 && p.act !== "dodge") { p.autoBlock = rng() < 0.4; p.autoDodge = !p.autoBlock && rng() < 0.2; }
    if (l.act !== "move") { p.autoBlock = false; p.autoDodge = false; }
    if (p.autoDodge && l.act === "move" && l.t > 0.25) { inp.dodge = true; p.autoDodge = false; }
    else if (p.autoBlock && l.act === "move") inp.block = true;
    else if (p.act === "idle" && p.cd <= 0) { if (rng() < 0.25) inp.kick = true; else inp.punch = true; }
    return inp;
  }

  function update(dt, input = {}) {
    const events = [];
    if (sim.over) return events;
    sim.time += dt;
    const p = sim.p, l = sim.l, inp = sim.auto ? autoInput() : input;
    if (sim.auto) sim.stats.autoTime += dt;

    // ---- player's choices ----
    if (p.act === "idle") {
      if (inp.dodge && p.dodgeCd <= 0) { p.act = "dodge"; p.t = 0; p.dodgeCd = DODGE.cooldown; }
      else if (inp.block) { p.act = "block"; p.t = 0; }
      else if (p.cd <= 0 && inp.kick) start(p, "kick", events);
      else if (p.cd <= 0 && inp.punch) start(p, "punch", events);
    } else if (p.act === "block" && !inp.block) setIdle(p, 0.08);

    // ---- the lecturer's choices ----
    if (l.act === "idle" && l.cd <= 0) start(l, "swing", events);

    // ---- advance both ----
    for (const f of [p, l]) {
      if (f.act === "ko") continue;
      f.t += dt; f.cd = Math.max(0, f.cd - dt); f.dodgeCd = Math.max(0, f.dodgeCd - dt);
      if (f.armor > 0) f.armor = Math.max(0, f.armor - dt);
      if (f.act === "move") {
        const m = MOVES[f.move];
        if (!f.hitDone && f.t >= m.wind) { f.hitDone = true; strike(f, events); if (sim.over) break; }
        if (f.act === "move" && f.t >= m.total) setIdle(f, f.id === "l" ? r(0.4, 0.9) / ls.pace : 0.08);
      } else if (f.act === "hit" && f.t >= STAGGER) { setIdle(f, f.id === "l" ? 0.35 : 0.05); f.armor = ARMOR; }
      else if (f.act === "dodge" && f.t >= DODGE.total) setIdle(f, 0.05);
    }
    if (!sim.over && sim.time >= TIME_LIMIT) {
      sim.over = true; sim.winner = p.hp / p.maxHp >= l.hp / l.maxHp ? "p" : "l";
      (sim.winner === "p" ? l : p).act = "ko"; events.push({ type: "ko", who: sim.winner === "p" ? "l" : "p" });
    }
    if (sim.over) events.push({ type: "end", winner: sim.winner });
    return events;
  }

  /** What the server is told. It only cares who won and roughly how the fight went. */
  function report() {
    return { won: sim.winner === "p", ms: Math.round(sim.time * 1000), landed: sim.stats.landed, taken: sim.stats.taken, auto: sim.time ? Math.round((sim.stats.autoTime / sim.time) * 100) : 0 };
  }
  return sim;
}
