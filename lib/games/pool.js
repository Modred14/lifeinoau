// lib/games/pool.js
// 8-ball pool, decided on the server. The browser only says where to aim, how hard to hit and (optionally) follow or draw. The SERVER then runs the
// whole shot as a physics simulation (ball-ball collisions, cushions, pockets, friction), applies the rules (groups, fouls, ball in hand, the 8 ball)
// and sends back the result plus a frame-by-frame recording so both screens can play the same shot. Nobody can claim a pocketed ball or a win.
//
// Table units: 1000 wide, 500 high, ball radius 12. x runs along the long side. Angle 0 points along +x, angles grow towards +y (down on a screen).
import { need } from "./errors.js";

export const info = { id: "POOL", name: "8-Ball Pool", blurb: "Aim, shoot and clear your balls, then sink the 8.", icon: "pool", turnSeconds: 120, seats: 2 };

export const TABLE = { w: 1000, h: 500, r: 12 };
/** [x, y, capture radius]: four corners and two middles. */
export const POCKETS = [[0, 0, 28], [500, 0, 24], [1000, 0, 28], [0, 500, 28], [500, 500, 24], [1000, 500, 28]];
export const HEAD = 250; // the head string: the opening break is played from behind it
const R = TABLE.r, DT = 1 / 600, FRAME_EVERY = 30, MAX_T = 12, DECEL = 230, DRAG = 0.28, STOP = 6, E_BALL = 0.96, E_WALL = 0.82, V_MIN = 160, V_MAX = 1800;

const solid = (n) => n >= 1 && n <= 7, stripe = (n) => n >= 9 && n <= 15;
export const groupOf = (n) => (solid(n) ? "solid" : stripe(n) ? "stripe" : null);

function rack(rng) {
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]; // 8 goes in the middle; one solid and one stripe on the back corners
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  const a = rest.findIndex(solid), s = rest.splice(a, 1)[0], b = rest.findIndex(stripe), t = rest.splice(b, 1)[0];
  const pos = [], balls = [];
  for (let row = 0; row < 5; row++) for (let j = 0; j <= row; j++) pos.push([700 + row * (2 * R * 0.8660254 + 0.3), 250 + (j - row / 2) * (2 * R + 0.3), row, j]);
  const order = pos.map(() => 0); const free = rest.slice();
  pos.forEach(([, , row, j], k) => { order[k] = row === 4 && j === 0 ? s : row === 4 && j === 4 ? t : row === 2 && j === 1 ? 8 : free.shift(); });
  balls[0] = { x: 250, y: 250, in: false };
  pos.forEach(([x, y], k) => { balls[order[k]] = { x, y, in: false }; });
  return balls;
}

export function create(rng) {
  const turn = rng() < 0.5 ? 0 : 1;
  return { turn, balls: rack(rng), groups: [null, null], ballInHand: true, breakShot: true, shots: 0, last: null, msg: "Break: place the cue ball behind the line and shoot." };
}
export const turnOf = (st) => st.turn;

/** Balls of a group still on the table. */
const remaining = (balls, g) => balls.reduce((a, b, n) => (b && !b.in && groupOf(n) === g ? a + 1 : a), 0);
const targets = (st, seat) => { const g = st.groups[seat]; if (!g) return "open"; return remaining(st.balls, g) ? g : "eight"; };

/**
 * Runs one shot. `balls` is [{x, y, in}]; the cue ball starts with the velocity given. Returns the end positions, what happened and the recording.
 * Pure and deterministic: the same input always gives the same shot.
 */
export function simulate(start, angle, power, spin = 0) {
  const B = start.map((b, n) => ({ n, x: b.x, y: b.y, vx: 0, vy: 0, in: !!b.in, pf: -1 }));
  const speed = V_MIN + (V_MAX - V_MIN) * power;
  B[0].vx = Math.cos(angle) * speed; B[0].vy = Math.sin(angle) * speed;
  const events = { first: null, pocketed: [], railAfter: false, cueRail: false, cuePocket: false, contactAt: -1 };
  const frames = []; let step = 0, spinUsed = false;
  const record = () => { const f = new Array(32); for (const b of B) { const hidden = b.in && b.pf < 0; f[b.n * 2] = hidden ? -1 : Math.round(b.x * 10); f[b.n * 2 + 1] = hidden ? -1 : Math.round(b.y * 10); } for (const b of B) if (b.in && b.pf >= 0) { b.pf = -1; } frames.push(f); };
  for (const b of B) if (b.in) { b.x = -1; b.y = -1; }
  record();
  const maxSteps = Math.round(MAX_T / DT);
  for (; step < maxSteps; step++) {
    let moving = false;
    for (const b of B) {
      if (b.in) continue;
      const sp = Math.hypot(b.vx, b.vy); if (sp === 0) continue;
      b.x += b.vx * DT; b.y += b.vy * DT;
      const ns = Math.max(0, sp - DECEL * DT) * (1 - DRAG * DT);
      if (ns < STOP) { b.vx = 0; b.vy = 0; } else { b.vx *= ns / sp; b.vy *= ns / sp; moving = true; }
    }
    // pockets first (a ball that reaches a pocket mouth is gone), then the cushions
    for (const b of B) {
      if (b.in) continue;
      for (const [px, py, pr] of POCKETS) if (Math.hypot(b.x - px, b.y - py) < pr) { b.in = true; b.vx = 0; b.vy = 0; b.x = px; b.y = py; b.pf = 1; events.pocketed.push({ n: b.n, t: step * DT }); if (b.n === 0) events.cuePocket = true; if (events.first !== null && b.n !== 0) events.railAfter = true; break; }
      if (b.in) continue;
      let hit = false;
      if (b.x < R) { b.x = R; if (b.vx < 0) { b.vx = -b.vx * E_WALL; b.vy *= 0.97; hit = true; } }
      else if (b.x > TABLE.w - R) { b.x = TABLE.w - R; if (b.vx > 0) { b.vx = -b.vx * E_WALL; b.vy *= 0.97; hit = true; } }
      if (b.y < R) { b.y = R; if (b.vy < 0) { b.vy = -b.vy * E_WALL; b.vx *= 0.97; hit = true; } }
      else if (b.y > TABLE.h - R) { b.y = TABLE.h - R; if (b.vy > 0) { b.vy = -b.vy * E_WALL; b.vx *= 0.97; hit = true; } }
      if (hit) { if (b.n === 0) events.cueRail = true; if (events.first !== null) events.railAfter = true; }
    }
    // ball against ball (two passes keep a tight cluster stable)
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 16; i++) { const a = B[i]; if (a.in) continue; for (let j = i + 1; j < 16; j++) { const c = B[j]; if (c.in) continue;
      const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy; if (d2 >= 4 * R * R || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, rv = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
      if (rv > 0) {
        if (events.first === null && (i === 0 || j === 0)) { events.first = i === 0 ? j : i; events.contactAt = step * DT; }
        const cueBefore = i === 0 ? { vx: a.vx, vy: a.vy } : j === 0 ? { vx: c.vx, vy: c.vy } : null;
        const imp = (rv * (1 + E_BALL)) / 2; a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny;
        if (cueBefore && !spinUsed && spin) { spinUsed = true; const q = i === 0 ? a : c; q.vx += cueBefore.vx * 0.45 * spin; q.vy += cueBefore.vy * 0.45 * spin; } // follow (+) rolls on, draw (-) pulls back
      }
      const push = (2 * R - d) / 2 + 0.01; a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push; } }
    for (const b of B) if (!b.in && (b.vx || b.vy)) moving = true;
    if ((step + 1) % FRAME_EVERY === 0) record();
    if (!moving) break;
  }
  for (const b of B) { b.vx = 0; b.vy = 0; } record();
  return { balls: B.map((b) => ({ x: b.in ? -1 : Math.round(b.x * 100) / 100, y: b.in ? -1 : Math.round(b.y * 100) / 100, in: b.in })), events, frames, steps: step };
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** { type: "shot", angle (radians), power (0..1), spin? (-1..1), cue? ({x, y} when you have the ball in hand) } */
export function act(state, seat, action, ctx = {}) {
  need(action?.type === "shot", "Take a shot.");
  need(seat === state.turn, "It is not your turn.");
  need(finite(action.angle) && finite(action.power), "That shot could not be read.");
  const power = Math.min(1, Math.max(0.03, action.power)), spin = finite(action.spin) ? Math.min(1, Math.max(-1, action.spin)) : 0;
  const st = { ...state, balls: state.balls.map((b) => ({ ...b })), groups: [...state.groups] };
  // ball in hand: the player puts the cue ball down where they like (behind the head string for the break), clear of every other ball
  if (st.ballInHand) {
    const c = action.cue ?? (!st.balls[0].in ? { x: st.balls[0].x, y: st.balls[0].y } : null);
    need(c && finite(c.x) && finite(c.y), "Place the cue ball on the table first.");
    const maxX = st.breakShot ? HEAD : TABLE.w - R;
    need(c.x >= R && c.x <= maxX && c.y >= R && c.y <= TABLE.h - R, st.breakShot ? "Place the cue ball behind the line for the break." : "Place the cue ball on the table.");
    for (let n = 1; n < 16; n++) { const b = st.balls[n]; if (!b.in) need(Math.hypot(b.x - c.x, b.y - c.y) >= 2 * R + 0.5, "The cue ball is on top of another ball."); }
    st.balls[0] = { x: c.x, y: c.y, in: false };
  } else need(!st.balls[0].in, "The cue ball is not on the table.");
  const want = targets(st, seat), res = simulate(st.balls, action.angle, power, spin), ev = res.events;
  const potted = ev.pocketed.filter((p) => p.n !== 0).map((p) => p.n), eight = potted.includes(8);
  // ---- fouls ----
  const fouls = [];
  if (ev.cuePocket) fouls.push("scratch");
  if (ev.first === null) fouls.push("the cue ball hit nothing");
  else {
    const f = ev.first;
    const ok = want === "open" ? f !== 8 : want === "eight" ? f === 8 : groupOf(f) === want;
    if (!ok) fouls.push(want === "eight" ? "you had to hit the 8 ball first" : want === "open" ? "you cannot hit the 8 ball first" : `you had to hit a ${want} first`);
  }
  if (ev.first !== null && !ev.railAfter && !potted.length) fouls.push("no ball reached a cushion");
  const foul = fouls.length > 0;
  // ---- apply the result ----
  res.balls.forEach((b, n) => { st.balls[n] = { x: b.x, y: b.y, in: b.in }; });
  st.shots++;
  const wasBreak = st.breakShot; st.breakShot = false;
  let over = null, msg = "";
  const rec = { seat, angle: action.angle, power, spin, first: ev.first, potted, foul, fouls, frames: res.frames, v: ctx.version ?? st.shots };
  if (eight) {
    if (wasBreak) { st.balls[8] = { x: 700, y: 250, in: false }; for (let n = 1; n < 16; n++) if (n !== 8 && !st.balls[n].in && Math.hypot(st.balls[n].x - 700, st.balls[n].y - 250) < 2 * R) st.balls[8] = { x: 640, y: 250, in: false }; msg = "The 8 ball went down on the break: it is spotted again."; }
    else {
      const cleared = !!state.groups[seat] && remaining(state.balls, state.groups[seat]) === 0; // before this shot: the 8 ball only counts once the group is gone
      const good = cleared && !foul; over = { winner: good ? seat : 1 - seat, reason: good ? "Sank the 8 ball to win." : !cleared ? "Sank the 8 ball too early." : "Sank the 8 ball but fouled." };
    }
  }
  // groups are decided by the first ball legally sunk on an open table
  let assigned = null;
  if (!over && !foul && st.groups[0] === null) { const first = potted.find((n) => n !== 8); if (first) { st.groups[seat] = groupOf(first); st.groups[1 - seat] = groupOf(first) === "solid" ? "stripe" : "solid"; assigned = st.groups[seat]; } }
  const own = !foul && (assigned ? potted.some((n) => n !== 8) : st.groups[seat] ? potted.some((n) => groupOf(n) === st.groups[seat]) : false);
  if (!over) {
    if (foul) { st.turn = 1 - seat; st.ballInHand = true; if (st.balls[0].in) st.balls[0] = { x: -1, y: -1, in: true }; msg = `Foul: ${fouls.join(", ")}. ${"Your opponent has the ball in hand."}`; }
    else if (own) { st.ballInHand = false; msg = assigned ? `You are ${assigned}s. Shoot again.` : "Good shot. Shoot again."; }
    else { st.turn = 1 - seat; st.ballInHand = false; msg = potted.length ? "That ball was not yours. Your opponent shoots." : "Nothing went down. Your opponent shoots."; }
  } else msg = over.reason;
  st.last = { ...rec, assigned }; st.msg = msg;
  return { state: st, over };
}

/** Frames are large, so only a screen that has not seen this shot yet is given them. */
export function view(state, seat, { since = 0 } = {}) {
  const last = state.last && { ...state.last, frames: undefined };
  const fresh = state.last && state.last.v > since;
  return { turn: state.turn, balls: state.balls, groups: state.groups, ballInHand: state.ballInHand, breakShot: state.breakShot, shots: state.shots, msg: state.msg,
    last: fresh ? { ...state.last } : last, targets: targets(state, state.turn), head: HEAD };
}
